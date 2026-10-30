// Service-role data access for the contract-esign module. The contracts table is
// staff/service-role managed (no anon/authenticated RLS policies), so all reads
// and writes here use the shared service-role client, which bypasses RLS. The
// client-facing sign route reaches these same helpers AFTER verifying a signed
// token (see src/tokens.ts + src/routes.ts) — the token is the gate, not RLS.
//
// Source PDFs, signature PNGs, and executed PDFs live in the PRIVATE `contracts` Storage
// bucket. Every Storage call degrades gracefully (warns, returns null) when the
// bucket is absent, so the module works before the ops bucket-creation step.

import "server-only";
import {
  attributeValue,
  attributesRecord,
  isMissingAttributesColumnError,
} from "@waltersignal/bananaforce-core";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import type { Contract, ContractStatus, SignAudit } from "./types";
import { CONTRACT_STATUSES } from "./types";

type Row = Record<string, unknown>;

/** Private Storage bucket holding source PDFs, signatures, and executed PDFs. */
export const CONTRACTS_BUCKET = "contracts";
const INSPECTION_REF_COLUMNS = [
  "id",
  "inspection_slug",
  "prospect_name",
  "prospect_company",
  "prospect_email",
  "office_address",
  "walkthrough_date",
  "visits_per_week",
  "scope_inclusions",
  "scope_exclusions",
  "cleaning_days",
  "clean_window",
  "target_start",
  "consumables_provided_by",
  "quote_base_monthly",
  "quote_rate_per_sqft",
  "cleanable_sqft",
  "status",
] as const;
const INSPECTION_REF_SELECT = [...INSPECTION_REF_COLUMNS, "attributes"].join(",");
const INSPECTION_REF_LEGACY_SELECT = INSPECTION_REF_COLUMNS.join(",");

// Minimal shape of the quote-engine `inspections` row this module reads
// (read-only reference — contract-esign does NOT own or write inspections).
export interface InspectionRef {
  id: string;
  inspection_slug: string | null;
  prospect_name: string | null;
  prospect_company: string | null;
  prospect_email: string | null;
  office_address: string | null;
  walkthrough_date: string | null;
  attributes?: Record<string, unknown>;
  visits_per_week: number | null;
  scope_inclusions: string | null;
  scope_exclusions: string | null;
  cleaning_days: string | null;
  clean_window: string | null;
  target_start: string | null;
  consumables_provided_by: string | null;
  quote_base_monthly: number | null;
  quote_rate_per_sqft: number | null;
  cleanable_sqft: number | null;
  status: string | null;
}

const MODULE_LABEL = "Contract e-sign";

const warn = (operation: string, error: unknown) =>
  warnSupabase(MODULE_LABEL, operation, error);

/**
 * Supabase Storage returns a 409 / "Duplicate" when uploading to an existing
 * object with upsert: false. Detect it so we can treat an already-persisted
 * signed artifact as success rather than overwriting it.
 */
function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { statusCode?: unknown; status?: unknown; error?: unknown; message?: unknown };
  const code = String(e.statusCode ?? e.status ?? "");
  if (code === "409") return true;
  const text = `${String(e.error ?? "")} ${String(e.message ?? "")}`.toLowerCase();
  return text.includes("already exists") || text.includes("duplicate") || text.includes("resource already exists");
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function statusOrPending(value: unknown): ContractStatus {
  return CONTRACT_STATUSES.includes(value as ContractStatus)
    ? (value as ContractStatus)
    : "pending";
}

/**
 * Env-only check (no I/O), safe to import from anywhere. Without the service-role
 * key the module degrades to setup-required rather than throwing.
 */
export function isContractEsignConfigured(): boolean {
  return isServiceRoleConfigured();
}

// The service-role client is shared from data-supabase — the single module that
// holds the service-role key (and is `server-only`). null when env is missing,
// so callers degrade to setup-required rather than throwing.
const getServiceClient = (operation: string) =>
  getServiceClientOrNull(MODULE_LABEL, operation);

function contractFromRow(row: Row): Contract {
  return {
    id: stringOrNull(row.id) ?? "",
    inspection_id: stringOrNull(row.inspection_id),
    title: stringOrNull(row.title),
    source_pdf_path: stringOrNull(row.source_pdf_path),
    signer_email: stringOrNull(row.signer_email),
    signer_address: stringOrNull(row.signer_address),
    deposit_amount_due: numberOrNull(row.deposit_amount_due),
    final_amount_due: numberOrNull(row.final_amount_due),
    card_fee_passthrough: row.card_fee_passthrough === true,
    deposit_invoice_id: stringOrNull(row.deposit_invoice_id),
    final_invoice_id: stringOrNull(row.final_invoice_id),
    sign_invite_sent_at: stringOrNull(row.sign_invite_sent_at),
    followup_texts: row.followup_texts === true,
    deposit_invoice_sent_at: stringOrNull(row.deposit_invoice_sent_at),
    crm_account_id: stringOrNull(row.crm_account_id),
    crm_opportunity_id: stringOrNull(row.crm_opportunity_id),
    crm_contact_id: stringOrNull(row.crm_contact_id),
    status: statusOrPending(row.status),
    signer_name: stringOrNull(row.signer_name),
    signer_title: stringOrNull(row.signer_title),
    signature_path: stringOrNull(row.signature_path),
    pdf_path: stringOrNull(row.pdf_path),
    signed_at: stringOrNull(row.signed_at),
    signed_ip: stringOrNull(row.signed_ip),
    signed_user_agent: stringOrNull(row.signed_user_agent),
    audit_method: stringOrNull(row.audit_method),
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function inspectionFromRow(row: Row): InspectionRef {
  return {
    id: stringOrNull(row.id) ?? "",
    inspection_slug: stringOrNull(row.inspection_slug),
    prospect_name: stringOrNull(row.prospect_name),
    prospect_company: stringOrNull(row.prospect_company),
    prospect_email: stringOrNull(row.prospect_email),
    office_address: stringOrNull(row.office_address),
    walkthrough_date: stringOrNull(row.walkthrough_date),
    attributes: attributesRecord(row.attributes),
    visits_per_week: numberOrNull(attributeValue(row, "visits_per_week")),
    scope_inclusions: stringOrNull(row.scope_inclusions),
    scope_exclusions: stringOrNull(row.scope_exclusions),
    cleaning_days: stringOrNull(attributeValue(row, "cleaning_days")),
    clean_window: stringOrNull(attributeValue(row, "clean_window")),
    target_start: stringOrNull(row.target_start),
    consumables_provided_by: stringOrNull(attributeValue(row, "consumables_provided_by")),
    quote_base_monthly: numberOrNull(row.quote_base_monthly),
    quote_rate_per_sqft: numberOrNull(row.quote_rate_per_sqft),
    cleanable_sqft: numberOrNull(attributeValue(row, "cleanable_sqft")),
    status: stringOrNull(row.status),
  };
}

// --- inspections (read-only reference) -----------------------------------

/** Read a quote-engine inspection for agreement context. Never written here. */
export async function getInspectionRef(id: string): Promise<InspectionRef | null> {
  const supabase = getServiceClient("getInspectionRef");
  if (!supabase) return null;

  let { data, error } = await supabase
    .from("inspections")
    .select(INSPECTION_REF_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error && isMissingAttributesColumnError(error)) {
    const retry = await supabase
      .from("inspections")
      .select(INSPECTION_REF_LEGACY_SELECT)
      .eq("id", id)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    warn("getInspectionRef", error);
    return null;
  }
  return data ? inspectionFromRow(data as unknown as Row) : null;
}

// --- contracts -----------------------------------------------------------

export async function getContract(id: string): Promise<Contract | null> {
  const supabase = getServiceClient("getContract");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    warn("getContract", error);
    return null;
  }
  return data ? contractFromRow(data as Row) : null;
}

/** Find the contract linked to a deposit invoice without loading the contract ledger. */
export async function getContractByDepositInvoice(
  invoiceId: string,
): Promise<Contract | null> {
  const supabase = getServiceClient("getContractByDepositInvoice");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("deposit_invoice_id", invoiceId)
    .limit(1)
    .maybeSingle();

  if (error) {
    warn("getContractByDepositInvoice", error);
    return null;
  }
  return data ? contractFromRow(data as Row) : null;
}

export async function listContracts(): Promise<Contract[]> {
  const supabase = getServiceClient("listContracts");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    warn("listContracts", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(contractFromRow);
}

/** The current active (non-void) contract for an inspection, if any. */
export async function getActiveContractForInspection(
  inspectionId: string,
): Promise<Contract | null> {
  const supabase = getServiceClient("getActiveContractForInspection");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("inspection_id", inspectionId)
    .neq("status", "void")
    .maybeSingle();

  if (error) {
    warn("getActiveContractForInspection", error);
    return null;
  }
  return data ? contractFromRow(data as Row) : null;
}

/**
 * Create (or return the existing) active contract for an inspection. The partial
 * unique index guarantees one active contract per inspection; this returns the
 * existing active row instead of erroring on a duplicate, so minting a sign link
 * twice is idempotent.
 */
export async function createContractForInspection(
  inspectionId: string,
): Promise<Contract | null> {
  const supabase = getServiceClient("createContractForInspection");
  if (!supabase) return null;

  const existing = await getActiveContractForInspection(inspectionId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("contracts")
    .insert({ inspection_id: inspectionId, status: "pending" })
    .select("*")
    .single();

  if (error) {
    // Lost a race on the unique index — return the now-existing active row.
    const raced = await getActiveContractForInspection(inspectionId);
    if (raced) return raced;
    warn("createContractForInspection", error);
    return null;
  }
  return data ? contractFromRow(data as Row) : null;
}

export interface CreateDocumentContractInput {
  title: string;
  signerName: string;
  signerEmail: string;
  pdfBytes: Uint8Array;
  depositAmountDue?: number | null;
  finalAmountDue?: number | null;
  cardFeePassthrough?: boolean;
  crmAccountId?: string | null;
  crmOpportunityId?: string | null;
  crmContactId?: string | null;
}

/** Upload a source PDF, then create its document-backed contract row. */
export async function createContractForDocument(
  input: CreateDocumentContractInput,
): Promise<Contract | null> {
  const supabase = getServiceClient("createContractForDocument");
  if (!supabase) return null;

  const id = crypto.randomUUID();
  const sourcePath = await uploadToContracts(
    sourcePdfPath(id),
    input.pdfBytes,
    "application/pdf",
  );
  if (!sourcePath) return null;

  const { data, error } = await supabase
    .from("contracts")
    .insert({
      id,
      title: input.title,
      source_pdf_path: sourcePath,
      signer_name: input.signerName,
      signer_email: input.signerEmail,
      deposit_amount_due: input.depositAmountDue ?? null,
      final_amount_due: input.finalAmountDue ?? null,
      card_fee_passthrough: input.cardFeePassthrough === true,
      crm_account_id: input.crmAccountId ?? null,
      crm_opportunity_id: input.crmOpportunityId ?? null,
      crm_contact_id: input.crmContactId ?? null,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    // First-write-wins Storage objects are intentionally not deleted here.
    warn(`createContractForDocument(orphan ${sourcePath})`, error);
    return null;
  }
  return data ? contractFromRow(data as Row) : null;
}

/** Flip a pending contract to 'sent' when its sign link is shared. */
export async function markContractSent(id: string): Promise<Contract | null> {
  const supabase = getServiceClient("markContractSent");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("contracts")
    .update({ status: "sent" })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    warn("markContractSent", error);
    return null;
  }
  // No row updated (already sent/signed) — return the current row unchanged.
  return data ? contractFromRow(data as Row) : getContract(id);
}

export interface MarkSignedInput {
  signerName: string;
  signerTitle?: string | null;
  signerAddress?: string | null;
  signaturePath: string | null;
  pdfPath: string | null;
  /** Execution timestamp captured by the route (matches the PDF audit stamp). */
  signedAtIso?: string;
  audit?: SignAudit;
}

/**
 * Stamp a contract as signed. Guards on status NOT already 'signed' so a
 * double-submit can't overwrite the first execution's audit trail. Returns the
 * already-signed row unchanged when the contract was signed before.
 */
export async function markContractSigned(
  id: string,
  input: MarkSignedInput,
): Promise<Contract | null> {
  const supabase = getServiceClient("markContractSigned");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("contracts")
    .update({
      status: "signed",
      signer_name: input.signerName,
      signer_title: input.signerTitle ?? null,
      // Only document contracts carry an address. Omitting the key keeps the
      // inspection UPDATE valid on databases without migration 0004.
      ...(input.signerAddress != null ? { signer_address: input.signerAddress } : {}),
      signature_path: input.signaturePath,
      pdf_path: input.pdfPath,
      signed_at: input.signedAtIso ?? new Date().toISOString(),
      signed_ip: input.audit?.ip ?? null,
      signed_user_agent: input.audit?.userAgent ?? null,
      audit_method: input.audit?.method ?? null,
    })
    .eq("id", id)
    // Only an open contract can be signed: never re-sign, never revive a void one.
    .in("status", ["pending", "sent"])
    .select("*")
    .maybeSingle();

  if (error) {
    warn("markContractSigned", error);
    return null;
  }
  return data ? contractFromRow(data as Row) : getContract(id);
}

/** Record that the automated sign-invite email was sent. */
export async function markSignInviteSent(id: string): Promise<Contract | null> {
  const supabase = getServiceClient("markSignInviteSent");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("contracts")
    .update({ sign_invite_sent_at: new Date().toISOString() })
    .eq("id", id)
    .is("sign_invite_sent_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("markSignInviteSent", error);
    return null;
  }
  return data ? contractFromRow(data as Row) : getContract(id);
}

/**
 * Attach a billing deposit invoice to a contract. The `is null` guard means a
 * retried sign request cannot attach a second invoice.
 */
export async function attachDepositInvoice(
  id: string,
  invoiceId: string,
): Promise<boolean> {
  const supabase = getServiceClient("attachDepositInvoice");
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("contracts")
    .update({ deposit_invoice_id: invoiceId })
    .eq("id", id)
    .is("deposit_invoice_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    warn("attachDepositInvoice", error);
    return false;
  }
  return Boolean(data);
}

/** Record when the deposit invoice email actually went out. */
export async function markDepositInvoiceSent(id: string): Promise<void> {
  const supabase = getServiceClient("markDepositInvoiceSent");
  if (!supabase) return;

  const { error } = await supabase
    .from("contracts")
    .update({ deposit_invoice_sent_at: new Date().toISOString() })
    .eq("id", id)
    .is("deposit_invoice_sent_at", null);
  if (error) warn("markDepositInvoiceSent", error);
}

// --- Storage (private `contracts` bucket) --------------------------------

/**
 * Object path for a contract's signature PNG. An `attempt` id gives each
 * document signing attempt its own objects, so a losing concurrent attempt can
 * never leave its artifacts under the paths the winning row records.
 */
export function signaturePath(contractId: string, attempt?: string): string {
  return attempt ? `${contractId}/signature-${attempt}.png` : `${contractId}/signature.png`;
}

/** Object path for an uploaded contract's original source PDF. */
export function sourcePdfPath(contractId: string): string {
  return `${contractId}/source.pdf`;
}

/** Object path for a contract's executed agreement PDF (see signaturePath). */
export function pdfPath(contractId: string, attempt?: string): string {
  return attempt ? `${contractId}/agreement-${attempt}.pdf` : `${contractId}/agreement.pdf`;
}

/**
 * Upload bytes to the private contracts bucket. Returns the stored path on
 * success or null when Storage is unavailable (e.g. the ops bucket-creation step
 * hasn't run yet) — the caller treats a null path as "not persisted" and the
 * PDF can still be regenerated on demand from the signed row.
 */
async function uploadToContracts(
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const supabase = getServiceClient("uploadToContracts");
  if (!supabase) return null;

  // upsert: false so a signed legal artifact is never silently overwritten. An
  // "already exists" conflict means the artifact was persisted by the first
  // execution — treat it as success and return the existing path (mirrors the DB
  // "first write wins" guard: markContractSigned's open-status filter).
  const { error } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .upload(path, body, { contentType, upsert: false });

  if (error) {
    if (isAlreadyExistsError(error)) return path;
    warn(`uploadToContracts(${path})`, error);
    return null;
  }
  return path;
}

/** Store a signature PNG; returns its Storage path or null when unavailable. */
export function storeSignaturePng(
  contractId: string,
  png: Uint8Array,
  attempt?: string,
): Promise<string | null> {
  return uploadToContracts(signaturePath(contractId, attempt), png, "image/png");
}

/** Store an executed contract PDF; returns its Storage path or null. */
export function storeContractPdf(
  contractId: string,
  pdf: Uint8Array,
  attempt?: string,
): Promise<string | null> {
  return uploadToContracts(pdfPath(contractId, attempt), pdf, "application/pdf");
}

/** Download stored bytes from the contracts bucket, or null when unavailable. */
export async function downloadFromContracts(
  path: string,
): Promise<Uint8Array | null> {
  const supabase = getServiceClient("downloadFromContracts");
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .download(path);

  if (error || !data) {
    if (error) warn(`downloadFromContracts(${path})`, error);
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}
