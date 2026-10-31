import assert from "node:assert/strict";
import {
  daysUntilExpiry,
  deriveLicenseStatus,
  documentValidationErrors,
  isExpiringStatus,
  licenseExpiryAlerts,
  licensePatch,
  licenseValidationErrors,
  localDateString,
  renewalValidationErrors,
  statusForExpiry,
  utcDateString,
} from "./lifecycle";
import type {
  CreateLicenseDocumentInput,
  CreateLicenseInput,
  License,
  RecordRenewalInput,
} from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

const NOW = "2026-08-19T15:30:00-04:00";

function makeLicenseInput(overrides: Partial<CreateLicenseInput> = {}): CreateLicenseInput {
  return {
    holder_type: "staff",
    staff_holder_id: "11111111-1111-4111-8111-111111111111",
    asset_holder_id: null,
    license_name: "Professional Engineer",
    issuing_authority: "Indiana Professional Licensing Agency",
    jurisdiction: "IN",
    license_number: "PE-123",
    issued_date: "2024-08-19",
    expiry_date: "2026-09-18",
    renewal_window_days: 30,
    ceu_hours_required: 30,
    notes: null,
    ...overrides,
  };
}

function makeLicense(overrides: Partial<License> = {}): License {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    legacy_id: null,
    source_system: null,
    ...makeLicenseInput(),
    ...overrides,
  };
}

function makeRenewalInput(overrides: Partial<RecordRenewalInput> = {}): RecordRenewalInput {
  return {
    license_id: "22222222-2222-4222-8222-222222222222",
    renewed_on: "2026-08-19",
    new_expiry_date: "2027-08-19",
    ceu_hours_completed: null,
    notes: null,
    ...overrides,
  };
}

function makeDocumentInput(
  overrides: Partial<CreateLicenseDocumentInput> = {},
): CreateLicenseDocumentInput {
  return {
    license_id: "22222222-2222-4222-8222-222222222222",
    renewal_id: null,
    document_kind: "certificate",
    storage_path: "22222222-2222-4222-8222-222222222222/2026-08/doc.pdf",
    media_type: "application/pdf",
    original_filename: "certificate.pdf",
    file_size_bytes: 1024,
    ...overrides,
  };
}

// --- derived status boundaries ---------------------------------------------

check(utcDateString(NOW) === "2026-08-19", "now is normalized to a UTC date");
check(statusForExpiry(null, 30, NOW) === "perpetual", "null expiry is perpetual");
check(statusForExpiry("2026-08-18", 30, NOW) === "expired", "yesterday is expired");
check(statusForExpiry("2026-08-19", 30, NOW) === "renewal_due", "expiry today is renewal_due");
check(
  statusForExpiry("2026-09-18", 30, NOW) === "renewal_due",
  "window edge is renewal_due",
);
check(
  statusForExpiry("2026-09-19", 30, NOW) === "active",
  "one day outside the renewal window is active",
);
check(
  statusForExpiry("2026-08-20", 0, NOW) === "active",
  "zero-day window keeps tomorrow active",
);
check(
  statusForExpiry("2026-08-19", 0, NOW) === "renewal_due",
  "zero-day window flags expiry today",
);
check(daysUntilExpiry("2026-08-19", NOW) === 0, "days until expiry is calendar based");
check(
  deriveLicenseStatus(makeLicense({ expiry_date: null }), NOW).status === "perpetual",
  "deriveLicenseStatus carries perpetual status",
);
check(isExpiringStatus("renewal_due"), "renewal_due is expiring");
check(isExpiringStatus("expired"), "expired is expiring");
check(!isExpiringStatus("active"), "active is not expiring");

assert.throws(
  () => statusForExpiry("2026-08-19", -1, NOW),
  /renewal_window_days/,
  "negative renewal windows throw in status derivation",
);
passed += 1;

// --- license validation mirrors SQL CHECKs ----------------------------------

check(licenseValidationErrors(makeLicenseInput()).length === 0, "valid staff license passes");
check(
  licenseValidationErrors(makeLicenseInput({ renewal_window_days: -1 })).includes(
    "renewal_window_days must be zero or greater",
  ),
  "negative renewal window is rejected",
);
check(
  licenseValidationErrors(makeLicenseInput({ issued_date: "08/19/2026" })).includes(
    "issued_date must be ISO yyyy-mm-dd",
  ),
  "non-ISO issued date is rejected",
);
check(
  licenseValidationErrors(
    makeLicenseInput({ issued_date: "2026-09-01", expiry_date: "2026-08-31" }),
  ).includes("issued_date must be on or before expiry_date"),
  "issued date after expiry is rejected",
);
check(
  licenseValidationErrors(
    makeLicenseInput({ holder_type: "vendor" as CreateLicenseInput["holder_type"] }),
  ).includes("holder_type must be staff, company, or asset"),
  "holder_type accepts only staff, company, or asset",
);
check(
  licenseValidationErrors(makeLicenseInput({ staff_holder_id: null })).includes(
    "staff_holder_id is required for staff licenses",
  ),
  "staff holder id is required for staff licenses",
);
check(
  licenseValidationErrors(
    makeLicenseInput({
      holder_type: "company",
      staff_holder_id: null,
      ceu_hours_required: null,
    }),
  ).length === 0,
  "company license is held by the firm with no holder id",
);
check(
  licenseValidationErrors(
    makeLicenseInput({
      holder_type: "company",
      staff_holder_id: "11111111-1111-4111-8111-111111111111",
      ceu_hours_required: null,
    }),
  ).includes("company licenses are held by the firm and take no holder id"),
  "company license rejects a staff id",
);
check(
  licenseValidationErrors(
    makeLicenseInput({
      holder_type: "asset",
      staff_holder_id: "11111111-1111-4111-8111-111111111111",
      asset_holder_id: "44444444-4444-4444-8444-444444444444",
      ceu_hours_required: null,
    }),
  ).includes("asset licenses cannot include staff_holder_id"),
  "asset license rejects a staff id",
);
check(
  licenseValidationErrors(
    makeLicenseInput({
      holder_type: "asset",
      staff_holder_id: null,
      asset_holder_id: "44444444-4444-4444-8444-444444444444",
      ceu_hours_required: null,
    }),
  ).length === 0,
  "asset holder uses asset_holder_id",
);
check(
  licenseValidationErrors(
    makeLicenseInput({
      holder_type: "asset",
      staff_holder_id: null,
      asset_holder_id: "44444444-4444-4444-8444-444444444444",
      ceu_hours_required: 4,
    }),
  ).includes("ceu_hours_required is only valid for staff licenses"),
  "CEU hours are staff-only",
);

// --- renewal and document validation -------------------------------

check(
  renewalValidationErrors(makeRenewalInput({ renewed_on: "2026/08/19" })).includes(
    "renewed_on must be ISO yyyy-mm-dd",
  ),
  "non-ISO renewal date is rejected",
);
check(
  renewalValidationErrors(makeRenewalInput({ ceu_hours_completed: -1 })).includes(
    "ceu_hours_completed must be zero or greater",
  ),
  "negative renewal CEU hours are rejected",
);
check(
  documentValidationErrors(makeDocumentInput()).length === 0,
  "valid license document passes",
);
check(
  documentValidationErrors(
    makeDocumentInput({ document_kind: "permit" as CreateLicenseDocumentInput["document_kind"] }),
  ).includes("document_kind must be card, certificate, or coi"),
  "document kind accepts exactly card, certificate, or coi",
);
check(
  documentValidationErrors(
    makeDocumentInput({ media_type: "text/plain" as CreateLicenseDocumentInput["media_type"] }),
  ).includes("media_type must be application/pdf, image/jpeg, image/png, or image/webp"),
  "document media type accepts only PDF/JPEG/PNG/WebP",
);
check(
  documentValidationErrors(makeDocumentInput({ file_size_bytes: -1 })).includes(
    "file_size_bytes must be zero or greater",
  ),
  "negative file size is rejected",
);

// --- expiry alerts -----------------------------------------------------------

{
  const alerts = licenseExpiryAlerts([
    deriveLicenseStatus(makeLicense({ id: "due", expiry_date: "2026-09-01" }), NOW),
    deriveLicenseStatus(makeLicense({ id: "ok", expiry_date: "2027-09-01" }), NOW),
    deriveLicenseStatus(makeLicense({ id: "forever", expiry_date: null }), NOW),
    deriveLicenseStatus(
      makeLicense({
        id: "firm",
        holder_type: "company",
        staff_holder_id: null,
        ceu_hours_required: null,
        expiry_date: "2026-08-01",
      }),
      NOW,
    ),
  ]);
  check(
    alerts.map((alert) => alert.license_id).join(",") === "due,firm",
    "alerts cover only renewal-due and expired licenses",
  );
  check(alerts[0].severity === "warning" && alerts[1].severity === "critical", "expired is critical");
  check(alerts[0].holder_id === "11111111-1111-4111-8111-111111111111", "staff alert carries the staff id");
  check(alerts[1].holder_id === null, "company alert has no holder id");
}

// update patches
{
  const from = (sent: Record<string, unknown>) => (field: string) =>
    field in sent ? sent[field] : undefined;

  const nameOnly = licensePatch(from({ license_name: " Master Electrician " }));
  check(
    JSON.stringify(nameOnly) === JSON.stringify({ license_name: "Master Electrician" }),
    "a patch carries only the fields sent",
  );

  const reassign = licensePatch(from({ asset_holder_id: "22222222-2222-4222-8222-222222222222" }));
  check(
    reassign.asset_holder_id === "22222222-2222-4222-8222-222222222222" && !("holder_type" in reassign),
    "a holder id can change without resending holder_type",
  );

  const toCompany = licensePatch(from({ holder_type: "company" }));
  check(
    toCompany.staff_holder_id === null && toCompany.asset_holder_id === null,
    "changing holder_type clears holder ids that were not sent",
  );

  const blanks = licensePatch(from({ renewal_window_days: "", expiry_date: "", license_name: "" }));
  check(!("renewal_window_days" in blanks), "a blank renewal window keeps the stored value");
  check(blanks.expiry_date === null, "a blank expiry clears it");
  check(blanks.license_name === "", "a blank required field stays a string for validation");
}

// firm-local date
{
  // 01:30 UTC on Aug 20 is 21:30 on Aug 19 in Fort Wayne.
  check(localDateString(new Date("2026-08-20T01:30:00Z")) === "2026-08-19", "today is the firm's date, not UTC");
  check(localDateString(new Date("2026-01-15T12:00:00Z")) === "2026-01-15", "midday is the same date");
}

console.log(`lifecycle.test.ts: ${passed} assertions passed`);
