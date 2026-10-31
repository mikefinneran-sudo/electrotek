import type {
  CreateLicenseDocumentInput,
  CreateLicenseInput,
  License,
  LicenseDocumentKind,
  LicenseExpiryAlert,
  LicenseDocumentMediaType,
  LicenseStatus,
  LicenseWithStatus,
  RecordRenewalInput,
  UpdateLicenseInput,
} from "./types";
import {
  LICENSE_DOCUMENT_KINDS,
  LICENSE_DOCUMENT_MEDIA_TYPES,
  LICENSE_HOLDER_TYPES,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type ExpiryPhase = "perpetual" | "expired" | "inside_window" | "outside_window";

interface ParsedDate {
  year: number;
  month: number;
  day: number;
  utcMs: number;
}

function parseIsoDate(value: string): ParsedDate | null {
  if (!ISO_DATE.test(value)) return null;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, utcMs: date.getTime() };
}

function isoDateFromParts(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

// ponytail: one zone for every client (all are Fort Wayne firms, same as
// core local-time). Move to ClientConfig when a client sits elsewhere.
export const LICENSE_TIME_ZONE = "America/Indiana/Indianapolis";

const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LICENSE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The firm's calendar date (YYYY-MM-DD), so "today" does not roll over at UTC midnight. */
export function localDateString(now: Date = new Date()): string {
  return localDateFormatter.format(now);
}

export function utcDateString(now: Date | string): string {
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) throw new Error("now must be a valid Date");
    return isoDateFromParts(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  }

  const dateOnly = parseIsoDate(now);
  if (dateOnly) return now;

  const parsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) throw new Error("now must be an ISO date or datetime");
  return isoDateFromParts(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

export function isIsoDate(value: string | null | undefined): boolean {
  return typeof value === "string" && parseIsoDate(value) !== null;
}

export function daysUntilExpiry(expiryDate: string | null, now: Date | string): number | null {
  if (expiryDate === null) return null;

  const expiry = parseIsoDate(expiryDate);
  if (!expiry) throw new Error("expiry_date must be ISO yyyy-mm-dd");

  const today = parseIsoDate(utcDateString(now));
  if (!today) throw new Error("now must resolve to an ISO date");

  return Math.round((expiry.utcMs - today.utcMs) / MS_PER_DAY);
}

function statusForPhase(phase: ExpiryPhase): LicenseStatus {
  switch (phase) {
    case "perpetual":
      return "perpetual";
    case "expired":
      return "expired";
    case "inside_window":
      return "renewal_due";
    case "outside_window":
      return "active";
  }

  const exhaustive: never = phase;
  throw new Error(`Unhandled expiry phase: ${exhaustive}`);
}

export function statusForExpiry(
  expiryDate: string | null,
  renewalWindowDays: number,
  now: Date | string,
): LicenseStatus {
  if (!Number.isInteger(renewalWindowDays) || renewalWindowDays < 0) {
    throw new Error("renewal_window_days must be a non-negative integer");
  }

  const days = daysUntilExpiry(expiryDate, now);
  const phase: ExpiryPhase =
    days === null
      ? "perpetual"
      : days < 0
        ? "expired"
        : days <= renewalWindowDays
          ? "inside_window"
          : "outside_window";

  return statusForPhase(phase);
}

export function deriveLicenseStatus(license: License, now: Date | string): LicenseWithStatus {
  const statusAsOf = utcDateString(now);
  const days = daysUntilExpiry(license.expiry_date, statusAsOf);

  return {
    ...license,
    status: statusForExpiry(license.expiry_date, license.renewal_window_days, statusAsOf),
    status_as_of: statusAsOf,
    days_until_expiry: days,
  };
}

export function isExpiringStatus(status: LicenseStatus): boolean {
  return status === "renewal_due" || status === "expired";
}

/** Renewal-due and expired licenses as alerts, in register order. */
export function licenseExpiryAlerts(licenses: LicenseWithStatus[]): LicenseExpiryAlert[] {
  return licenses.flatMap((license) => {
    const { status, expiry_date, days_until_expiry } = license;
    if ((status !== "renewal_due" && status !== "expired") || expiry_date === null || days_until_expiry === null) {
      return [];
    }
    return [
      {
        id: `license:${license.id}:${status}:${expiry_date}`,
        license_id: license.id,
        status,
        severity: status === "expired" ? "critical" : "warning",
        license_name: license.license_name,
        holder_type: license.holder_type,
        holder_id:
          license.holder_type === "staff"
            ? license.staff_holder_id
            : license.holder_type === "asset"
              ? license.asset_holder_id
              : null,
        expiry_date,
        days_until_expiry,
        status_as_of: license.status_as_of,
        message:
          status === "expired"
            ? `${license.license_name} expired on ${expiry_date}.`
            : `${license.license_name} renews by ${expiry_date}.`,
      },
    ];
  });
}

function stringRequired(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validateOptionalIsoDate(field: string, value: string | null | undefined): string[] {
  if (value == null || value === "") return [];
  return isIsoDate(value) ? [] : [`${field} must be ISO yyyy-mm-dd`];
}

function validateNumber(
  field: string,
  value: number | null | undefined,
  options: { integer?: boolean; required?: boolean } = {},
): string[] {
  if (value == null) return options.required ? [`${field} is required`] : [];
  if (!Number.isFinite(value)) return [`${field} must be a number`];
  if (options.integer && !Number.isInteger(value)) return [`${field} must be an integer`];
  if (value < 0) return [`${field} must be zero or greater`];
  return [];
}

export function licenseValidationErrors(input: CreateLicenseInput): string[] {
  const errors: string[] = [];

  if (!LICENSE_HOLDER_TYPES.includes(input.holder_type)) {
    errors.push("holder_type must be staff, company, or asset");
    return errors;
  }

  if (!stringRequired(input.license_name)) errors.push("license_name is required");
  if (!stringRequired(input.issuing_authority)) errors.push("issuing_authority is required");

  errors.push(...validateNumber("renewal_window_days", input.renewal_window_days, {
    integer: true,
    required: true,
  }));
  errors.push(...validateNumber("ceu_hours_required", input.ceu_hours_required));
  errors.push(...validateOptionalIsoDate("issued_date", input.issued_date));
  errors.push(...validateOptionalIsoDate("expiry_date", input.expiry_date));

  if (
    input.issued_date &&
    input.expiry_date &&
    isIsoDate(input.issued_date) &&
    isIsoDate(input.expiry_date) &&
    input.issued_date > input.expiry_date
  ) {
    errors.push("issued_date must be on or before expiry_date");
  }

  if (input.ceu_hours_required !== null && input.holder_type !== "staff") {
    errors.push("ceu_hours_required is only valid for staff licenses");
  }

  if (input.holder_type === "staff") {
    if (!input.staff_holder_id) errors.push("staff_holder_id is required for staff licenses");
    if (input.asset_holder_id) errors.push("staff licenses cannot include asset_holder_id");
  }

  if (input.holder_type === "company") {
    if (input.staff_holder_id || input.asset_holder_id) {
      errors.push("company licenses are held by the firm and take no holder id");
    }
  }

  if (input.holder_type === "asset") {
    if (!input.asset_holder_id) errors.push("asset_holder_id is required for asset licenses");
    if (input.staff_holder_id) errors.push("asset licenses cannot include staff_holder_id");
  }

  return [...new Set(errors)];
}

export function renewalValidationErrors(input: RecordRenewalInput): string[] {
  const errors: string[] = [];
  if (!stringRequired(input.license_id)) errors.push("license_id is required");
  if (!isIsoDate(input.renewed_on)) errors.push("renewed_on must be ISO yyyy-mm-dd");
  errors.push(...validateOptionalIsoDate("new_expiry_date", input.new_expiry_date));
  errors.push(...validateNumber("ceu_hours_completed", input.ceu_hours_completed));
  return errors;
}

export function documentValidationErrors(input: CreateLicenseDocumentInput): string[] {
  const errors: string[] = [];
  if (!stringRequired(input.license_id)) errors.push("license_id is required");
  if (!LICENSE_DOCUMENT_KINDS.includes(input.document_kind as LicenseDocumentKind)) {
    errors.push("document_kind must be card, certificate, or coi");
  }
  if (!stringRequired(input.storage_path)) errors.push("storage_path is required");
  if (!LICENSE_DOCUMENT_MEDIA_TYPES.includes(input.media_type as LicenseDocumentMediaType)) {
    errors.push("media_type must be application/pdf, image/jpeg, image/png, or image/webp");
  }
  errors.push(...validateNumber("file_size_bytes", input.file_size_bytes, { integer: true }));
  return errors;
}

const PATCH_TEXT_FIELDS = [
  "staff_holder_id",
  "asset_holder_id",
  "license_name",
  "issuing_authority",
  "jurisdiction",
  "license_number",
  "issued_date",
  "expiry_date",
  "notes",
] as const;

function patchText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value);
  return text.length > 0 ? text : null;
}

/**
 * An update patch of only the fields the caller sent, so omitted fields keep
 * their stored values. `read` returns undefined for a field that was not sent.
 * Sending holder_type clears whichever holder id was not sent with it.
 */
export function licensePatch(read: (field: string) => unknown): UpdateLicenseInput {
  const patch: Record<string, unknown> = {};
  for (const field of PATCH_TEXT_FIELDS) {
    const raw = read(field);
    if (raw !== undefined) patch[field] = patchText(raw);
  }
  // Required text stays a string so validation names the missing field.
  if (patch.license_name === null) patch.license_name = "";
  if (patch.issuing_authority === null) patch.issuing_authority = "";

  const holderType = read("holder_type");
  if (holderType !== undefined) {
    patch.holder_type = patchText(holderType) ?? "";
    patch.staff_holder_id ??= null;
    patch.asset_holder_id ??= null;
  }

  // Not nullable: a blank window leaves the stored value alone.
  const window = patchText(read("renewal_window_days"));
  if (window !== null) patch.renewal_window_days = Number(window);

  const ceu = read("ceu_hours_required");
  if (ceu !== undefined) {
    const text = patchText(ceu);
    patch.ceu_hours_required = text === null ? null : Number(text);
  }
  return patch as UpdateLicenseInput;
}
