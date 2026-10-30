import type { CorporateDocType, CorporateEntityType, FilingFrequency, RegistrationKind, RegistrationStatus } from "./types";

const EIN_PATTERN = /^\d{2}-\d{7}$/;
const STATE_PATTERN = /^[A-Z]{2}$/;
const FISCAL_YEAR_END_PATTERN = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const ONEPASSWORD_REF_PATTERN = /^op:\/\//;

export const CORPORATE_ENTITY_TYPES: readonly CorporateEntityType[] = [
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "sole_prop",
  "nonprofit",
  "other",
];

export const REGISTRATION_KINDS: readonly RegistrationKind[] = [
  "sos_foreign_qualification",
  "sales_tax_permit",
  "withholding_account",
  "unemployment_suta",
  "franchise_tax",
  "local_business_license",
  "professional_license",
  "other",
];

export const REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  "active",
  "inactive",
  "pending",
];

export const FILING_FREQUENCIES: readonly FilingFrequency[] = [
  "annual",
  "biennial",
  "quarterly",
  "monthly",
  "one_time",
];

export const CORPORATE_DOC_TYPES: readonly CorporateDocType[] = [
  "ein_letter",
  "articles",
  "operating_agreement",
  "state_registration",
  "annual_report",
  "tax_certificate",
  "other",
];

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Vercel Functions reject request bodies over 4.5 MB before the route runs,
// so the app cap sits under that with room for multipart overhead.
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export function isValidEin(value: string): boolean {
  return EIN_PATTERN.test(value);
}

export function isValidUsState(value: string): boolean {
  return STATE_PATTERN.test(value);
}

export function isValidFiscalYearEnd(value: string): boolean {
  if (!FISCAL_YEAR_END_PATTERN.test(value)) return false;
  const [m, d] = value.split("-").map(Number);
  // Leap year so 02-29 is allowed; 02-31 and 04-31 are not.
  return d <= lastDayOfMonth(2024, m);
}

export function isValidOnepasswordRef(value: string): boolean {
  return ONEPASSWORD_REF_PATTERN.test(value);
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseIsoDateOnly(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

export function formatIsoDateOnly(parts: { y: number; m: number; d: number }): string {
  const mm = String(parts.m).padStart(2, "0");
  const dd = String(parts.d).padStart(2, "0");
  return `${parts.y}-${mm}-${dd}`;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(parts: { y: number; m: number; d: number }, months: number): { y: number; m: number; d: number } {
  const zeroBased = parts.m - 1 + months;
  const y = parts.y + Math.floor(zeroBased / 12);
  const m = ((zeroBased % 12) + 12) % 12 + 1;
  const lastDay = lastDayOfMonth(y, m);
  // A month-end due date stays month-end (Form 941: Apr 30 → Jul 31), so
  // repeated advances never drift off the last day.
  const d = parts.d === lastDayOfMonth(parts.y, parts.m) ? lastDay : Math.min(parts.d, lastDay);
  return { y, m, d };
}

/**
 * Advance a due date by filing frequency. Month-end safe (Jan 31 monthly → Feb 28/29,
 * Apr 30 quarterly → Jul 31). Returns null for one_time filings (no next obligation).
 */
export function advanceDueDate(
  dueDateIso: string,
  frequency: FilingFrequency,
): string | null {
  if (frequency === "one_time") return null;
  const parts = parseIsoDateOnly(dueDateIso);
  if (!parts) return null;

  const monthsToAdd =
    frequency === "monthly"
      ? 1
      : frequency === "quarterly"
        ? 3
        : frequency === "annual"
          ? 12
          : 24;

  return formatIsoDateOnly(addMonths(parts, monthsToAdd));
}

export function compareIsoDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

export function filingDueStatus(
  nextDueDate: string | null,
  todayIso: string,
): "overdue" | "due_soon" | "ok" | "none" {
  if (!nextDueDate) return "none";
  const today = parseIsoDateOnly(todayIso);
  const due = parseIsoDateOnly(nextDueDate);
  if (!today || !due) return "none";

  const todayMs = Date.UTC(today.y, today.m - 1, today.d);
  const dueMs = Date.UTC(due.y, due.m - 1, due.d);
  if (dueMs < todayMs) return "overdue";

  const soonMs = todayMs + 30 * 24 * 60 * 60 * 1000;
  if (dueMs <= soonMs) return "due_soon";
  return "ok";
}

export function trimOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
