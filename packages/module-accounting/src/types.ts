export type SyncStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export const SYNC_STATUSES: readonly SyncStatus[] = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
];

export type ConnectorName = "tiller" | "wave";

export const CONNECTOR_NAMES: readonly ConnectorName[] = ["tiller", "wave"];

/** Internal category keys mapped to Tiller/Wave accounts. Seeded by migration. */
export const DEFAULT_ACCOUNT_MAP_KEYS = [
  "revenue.payment",
  "revenue.order",
  "revenue.refund",
  "accounts_receivable",
  "cash.stripe",
] as const;

export type DefaultAccountMapKey = (typeof DEFAULT_ACCOUNT_MAP_KEYS)[number];

export interface DefaultAccountMapEntry {
  internal_key: DefaultAccountMapKey;
  external_id: string;
  label: string;
}

export const DEFAULT_ACCOUNT_MAP_ENTRIES: readonly DefaultAccountMapEntry[] = [
  {
    internal_key: "revenue.payment",
    external_id: "Payment Revenue",
    label: "Card / Stripe payments",
  },
  {
    internal_key: "revenue.order",
    external_id: "Order Revenue",
    label: "Submitted wholesale/retail orders",
  },
  {
    internal_key: "revenue.refund",
    external_id: "Refunds",
    label: "Payment reversals",
  },
  {
    internal_key: "accounts_receivable",
    external_id: "Accounts Receivable",
    label: "Open invoices",
  },
  {
    internal_key: "cash.stripe",
    external_id: "Stripe Clearing",
    label: "Stripe settlement account",
  },
];

export type SyncDirection = "inbound" | "outbound";

export type SyncTrigger = "manual" | "event" | "cron";

export type OutboxStatus = "pending" | "processing" | "done" | "failed";

export const OUTBOX_STATUSES: readonly OutboxStatus[] = [
  "pending",
  "processing",
  "done",
  "failed",
];

export type LedgerEntityType = "invoice" | "customer" | "payment" | "order";

export const LEDGER_ENTITY_TYPES: readonly LedgerEntityType[] = [
  "invoice",
  "customer",
  "payment",
  "order",
];

export type LedgerEventType =
  | "payment.succeeded"
  | "payment.refunded"
  | "invoice.opened"
  | "order.submitted"
  | "expense.recorded";

export const LEDGER_EVENT_TYPES: readonly LedgerEventType[] = [
  "payment.succeeded",
  "payment.refunded",
  "invoice.opened",
  "order.submitted",
  "expense.recorded",
];

/** Input for enqueueLedgerEventInternal / cross-module events API. */
export interface EnqueueLedgerEventInput {
  eventType: LedgerEventType;
  sourceModule: string;
  sourceId: string;
  payload?: LedgerEventPayload;
}

export interface EnqueueLedgerEventResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  duplicate?: boolean;
}

/** Payload stored on ledger_outbox rows. Keep JSON-serializable. */
export interface LedgerEventPayload {
  invoice_id?: string;
  payment_id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  invoice_number?: string;
  description?: string;
}

/** A ledger sync log row. Mirrors the `ledger_sync_log` table. */
export interface LedgerSyncLog {
  id: string;
  connector: ConnectorName;
  status: SyncStatus;
  started_at: string;
  finished_at: string | null;
  records_synced: number;
  error: string | null;
  direction: SyncDirection | null;
  trigger_source: SyncTrigger | null;
  idempotency_key: string | null;
  created_at: string;
}

/** A ledger account map row. Mirrors the `ledger_account_map` table. */
export interface LedgerAccountMap {
  id: string;
  connector: ConnectorName;
  internal_key: string;
  external_id: string;
  label: string | null;
  created_at: string;
}

/** A ledger entity map row. Mirrors the `ledger_entity_map` table. */
export interface LedgerEntityMap {
  id: string;
  connector: ConnectorName;
  entity_type: LedgerEntityType;
  internal_id: string;
  external_id: string;
  created_at: string;
}

/** A ledger outbox row. Mirrors the `ledger_outbox` table. */
export interface LedgerOutboxEvent {
  id: string;
  event_type: LedgerEventType;
  source_module: string;
  source_id: string;
  payload: LedgerEventPayload;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  idempotency_key: string;
  created_at: string;
  processed_at: string | null;
}

/** Tiller export row (BananaFORCE Export tab). */
export interface TillerExportRow {
  date: string;
  description: string;
  amount: number;
  category: string;
  sourceModule: string;
  sourceRef: string;
  idempotencyKey: string;
}

/** Staff-chosen automatic export timing. */
export type ExportSchedule =
  | "manual"
  | "when_recorded"
  | "daily"
  | "weekly";

export const EXPORT_SCHEDULE_VALUES: readonly ExportSchedule[] = [
  "manual",
  "when_recorded",
  "daily",
  "weekly",
];

/** Mirrors `ledger_export_settings` (singleton row). */
export interface ExportSettings {
  schedule: ExportSchedule;
  last_automatic_export_at: string | null;
  updated_at: string;
}

export type CorporateEntityType =
  | "llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "sole_prop"
  | "nonprofit"
  | "other";

export type RegistrationKind =
  | "sos_foreign_qualification"
  | "sales_tax_permit"
  | "withholding_account"
  | "unemployment_suta"
  | "franchise_tax"
  | "local_business_license"
  | "professional_license"
  | "other";

export type RegistrationStatus = "active" | "inactive" | "pending";

export type FilingFrequency =
  | "annual"
  | "biennial"
  | "quarterly"
  | "monthly"
  | "one_time";

export type CorporateDocType =
  | "ein_letter"
  | "articles"
  | "operating_agreement"
  | "state_registration"
  | "annual_report"
  | "tax_certificate"
  | "other";

export interface CorporateProfile {
  singleton: boolean;
  legal_name: string | null;
  dba_names: string[];
  entity_type: CorporateEntityType | null;
  tax_classification: string | null;
  ein: string | null;
  formation_state: string | null;
  formation_date: string | null;
  sos_entity_number: string | null;
  registered_agent_name: string | null;
  registered_agent_address: string | null;
  principal_address: string | null;
  mailing_address: string | null;
  fiscal_year_end: string | null;
  naics_code: string | null;
  duns_or_uei: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface CorporateRegistration {
  id: string;
  jurisdiction: string;
  kind: RegistrationKind;
  label: string;
  identifier: string | null;
  agency_name: string | null;
  portal_url: string | null;
  onepassword_ref: string | null;
  effective_date: string | null;
  status: RegistrationStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CorporateFiling {
  id: string;
  registration_id: string | null;
  jurisdiction: string;
  name: string;
  frequency: FilingFrequency;
  next_due_date: string | null;
  last_filed_date: string | null;
  last_confirmation: string | null;
  portal_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CorporateDocument {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  doc_type: CorporateDocType;
  registration_id: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface CorporateSnapshot {
  profile: CorporateProfile | null;
  registrations: CorporateRegistration[];
  filings: CorporateFiling[];
  documents: CorporateDocument[];
}
