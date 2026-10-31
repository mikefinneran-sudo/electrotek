export type LicenseHolderType = "staff" | "company" | "asset";

export const LICENSE_HOLDER_TYPES: readonly LicenseHolderType[] = [
  "staff",
  "company",
  "asset",
];

export type LicenseDocumentKind = "card" | "certificate" | "coi";

export const LICENSE_DOCUMENT_KINDS: readonly LicenseDocumentKind[] = [
  "card",
  "certificate",
  "coi",
];

export type LicenseDocumentMediaType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export const LICENSE_DOCUMENT_MEDIA_TYPES: readonly LicenseDocumentMediaType[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export type LicenseStatus = "active" | "renewal_due" | "expired" | "perpetual";

export const LICENSE_STATUSES: readonly LicenseStatus[] = [
  "active",
  "renewal_due",
  "expired",
  "perpetual",
];

export interface License {
  id: string;
  holder_type: LicenseHolderType;
  staff_holder_id: string | null;
  asset_holder_id: string | null;
  license_name: string;
  issuing_authority: string;
  jurisdiction: string | null;
  license_number: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  renewal_window_days: number;
  ceu_hours_required: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  legacy_id: string | null;
  source_system: string | null;
}

export interface LicenseRenewal {
  id: string;
  license_id: string;
  renewed_on: string;
  previous_expiry_date: string | null;
  new_expiry_date: string | null;
  ceu_hours_completed: number | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
  created_at: string;
  legacy_id: string | null;
  source_system: string | null;
}

export interface LicenseDocument {
  id: string;
  license_id: string;
  renewal_id: string | null;
  document_kind: LicenseDocumentKind;
  storage_path: string;
  media_type: LicenseDocumentMediaType;
  original_filename: string | null;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  created_at: string;
  legacy_id: string | null;
  source_system: string | null;
}

export interface LicenseWithStatus extends License {
  status: LicenseStatus;
  status_as_of: string;
  days_until_expiry: number | null;
}

export interface LicenseDocumentWithUrl extends LicenseDocument {
  signed_url: string | null;
}

/** A staff member or asset offered as a license holder. */
export interface HolderOption {
  id: string;
  label: string;
}

export interface LicenseExpiryAlert {
  id: string;
  license_id: string;
  status: Extract<LicenseStatus, "renewal_due" | "expired">;
  severity: "warning" | "critical";
  license_name: string;
  holder_type: LicenseHolderType;
  /** Null for company licenses: the holder is the firm itself. */
  holder_id: string | null;
  expiry_date: string;
  days_until_expiry: number;
  status_as_of: string;
  message: string;
}

export interface CreateLicenseInput {
  holder_type: LicenseHolderType;
  staff_holder_id: string | null;
  asset_holder_id: string | null;
  license_name: string;
  issuing_authority: string;
  jurisdiction: string | null;
  license_number: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  renewal_window_days: number;
  ceu_hours_required: number | null;
  notes: string | null;
}

export type UpdateLicenseInput = Partial<CreateLicenseInput>;

export interface RecordRenewalInput {
  license_id: string;
  renewed_on: string;
  new_expiry_date: string | null;
  ceu_hours_completed: number | null;
  notes: string | null;
}

export interface CreateLicenseDocumentInput {
  license_id: string;
  renewal_id: string | null;
  document_kind: LicenseDocumentKind;
  storage_path: string;
  media_type: LicenseDocumentMediaType;
  original_filename: string | null;
  file_size_bytes: number | null;
}
