import "server-only";

import { randomUUID } from "node:crypto";
import { isDemo } from "@waltersignal/bananaforce-core/demo";
import { recordAudit, type AuditActor } from "@waltersignal/bananaforce-data-supabase/audit";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import {
  advanceDueDate,
  ALLOWED_DOCUMENT_MIME_TYPES,
  CORPORATE_DOC_TYPES,
  CORPORATE_ENTITY_TYPES,
  FILING_FREQUENCIES,
  isValidEin,
  isValidFiscalYearEnd,
  isValidHttpUrl,
  isValidOnepasswordRef,
  isValidUsState,
  MAX_DOCUMENT_BYTES,
  parseIsoDateOnly,
  REGISTRATION_KINDS,
  REGISTRATION_STATUSES,
  trimOptionalText,
} from "./corporate-logic";
import type {
  CorporateDocType,
  CorporateEntityType,
  CorporateFiling,
  CorporateProfile,
  CorporateRegistration,
  CorporateSnapshot,
  FilingFrequency,
  RegistrationKind,
  RegistrationStatus,
} from "./types";

const BUCKET = "corporate-documents";
const SIGNED_URL_TTL = 300;
const MODULE_LABEL = "Corporate";

type Row = Record<string, unknown>;

export function isCorporateInfoConfigured(): boolean {
  return isServiceRoleConfigured();
}

function supabase(operation: string) {
  return getServiceClientOrNull(MODULE_LABEL, operation);
}

function mapProfile(row: Row | null): CorporateProfile | null {
  if (!row) return null;
  return {
    singleton: Boolean(row.singleton),
    legal_name: (row.legal_name as string | null) ?? null,
    dba_names: Array.isArray(row.dba_names) ? (row.dba_names as string[]) : [],
    entity_type: (row.entity_type as CorporateEntityType | null) ?? null,
    tax_classification: (row.tax_classification as string | null) ?? null,
    ein: (row.ein as string | null) ?? null,
    formation_state: (row.formation_state as string | null) ?? null,
    formation_date: (row.formation_date as string | null) ?? null,
    sos_entity_number: (row.sos_entity_number as string | null) ?? null,
    registered_agent_name: (row.registered_agent_name as string | null) ?? null,
    registered_agent_address: (row.registered_agent_address as string | null) ?? null,
    principal_address: (row.principal_address as string | null) ?? null,
    mailing_address: (row.mailing_address as string | null) ?? null,
    fiscal_year_end: (row.fiscal_year_end as string | null) ?? null,
    naics_code: (row.naics_code as string | null) ?? null,
    duns_or_uei: (row.duns_or_uei as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    updated_at: String(row.updated_at),
    updated_by: (row.updated_by as string | null) ?? null,
  };
}

function mapRegistration(row: Row): CorporateRegistration {
  return {
    id: String(row.id),
    jurisdiction: String(row.jurisdiction),
    kind: row.kind as RegistrationKind,
    label: String(row.label),
    identifier: (row.identifier as string | null) ?? null,
    agency_name: (row.agency_name as string | null) ?? null,
    portal_url: (row.portal_url as string | null) ?? null,
    onepassword_ref: (row.onepassword_ref as string | null) ?? null,
    effective_date: (row.effective_date as string | null) ?? null,
    status: row.status as RegistrationStatus,
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapFiling(row: Row): CorporateFiling {
  return {
    id: String(row.id),
    registration_id: (row.registration_id as string | null) ?? null,
    jurisdiction: String(row.jurisdiction),
    name: String(row.name),
    frequency: row.frequency as FilingFrequency,
    next_due_date: (row.next_due_date as string | null) ?? null,
    last_filed_date: (row.last_filed_date as string | null) ?? null,
    last_confirmation: (row.last_confirmation as string | null) ?? null,
    portal_url: (row.portal_url as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

async function audit(
  actor: AuditActor | undefined,
  event: {
    action: string;
    resource_type: string;
    resource_id?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await recordAudit(supabase("audit"), { ...(actor ?? {}), ...event });
}

async function ensureDemoFixture(): Promise<void> {
  if (!isDemo()) return;
  const client = supabase("ensureDemoFixture");
  if (!client) return;

  const { count, error } = await client
    .from("corporate_profile")
    .select("singleton", { count: "exact", head: true });
  if (error) {
    warnSupabase("Corporate", "ensureDemoFixture", error);
    return;
  }
  if ((count ?? 0) > 0) return;

  const now = new Date().toISOString();
  // Concurrent first loads both see count 0; only the request whose insert
  // wins seeds the child rows, so the fixture is never duplicated.
  const { data: created } = await client.from("corporate_profile").upsert({
    singleton: true,
    legal_name: "Demo Holdings LLC",
    dba_names: ["BananaFORCE Demo Co."],
    entity_type: "llc",
    tax_classification: "Disregarded entity (demo)",
    ein: "00-0000000",
    formation_state: "IN",
    formation_date: "2020-01-15",
    sos_entity_number: "DEMO-000000",
    principal_address: "123 Demo Street, Indianapolis, IN 46204",
    fiscal_year_end: "12-31",
    updated_at: now,
  }, { onConflict: "singleton", ignoreDuplicates: true }).select("singleton");
  if (!created?.length) return;

  const { data: reg } = await client
    .from("corporate_registrations")
    .insert({
      jurisdiction: "IN",
      kind: "sos_foreign_qualification",
      label: "Indiana Secretary of State",
      identifier: "DEMO-SOS-001",
      agency_name: "Indiana Secretary of State",
      portal_url: "https://example.com/demo-sos",
      status: "active",
    })
    .select("id")
    .single();

  await client.from("corporate_filings").insert({
    jurisdiction: "IN",
    registration_id: reg?.id ?? null,
    name: "Indiana Business Entity Report",
    frequency: "biennial",
    next_due_date: "2027-03-15",
    portal_url: "https://example.com/demo-ber",
  });
}

export async function getCorporateSnapshot(): Promise<CorporateSnapshot | null> {
  const client = supabase("getCorporateSnapshot");
  if (!client) return null;

  await ensureDemoFixture();

  const [profileRes, registrationsRes, filingsRes, documentsRes] = await Promise.all([
    client.from("corporate_profile").select("*").maybeSingle(),
    client.from("corporate_registrations").select("*").order("jurisdiction").order("label"),
    client.from("corporate_filings").select("*").order("next_due_date", { ascending: true, nullsFirst: false }),
    client.from("corporate_documents").select("*").order("created_at", { ascending: false }),
  ]);

  for (const res of [profileRes, registrationsRes, filingsRes, documentsRes]) {
    if (res.error) {
      warnSupabase("Corporate", "getCorporateSnapshot", res.error);
      return null;
    }
  }

  return {
    profile: mapProfile(profileRes.data as Row | null),
    registrations: (registrationsRes.data ?? []).map((row) => mapRegistration(row as Row)),
    filings: (filingsRes.data ?? []).map((row) => mapFiling(row as Row)),
    documents: (documentsRes.data ?? []).map((row) => ({
      id: String(row.id),
      storage_path: String(row.storage_path),
      file_name: String(row.file_name),
      mime_type: String(row.mime_type),
      size_bytes: Number(row.size_bytes),
      doc_type: row.doc_type as CorporateDocType,
      registration_id: (row.registration_id as string | null) ?? null,
      uploaded_by: (row.uploaded_by as string | null) ?? null,
      created_at: String(row.created_at),
    })),
  };
}

export interface UpsertCorporateProfileInput {
  legal_name?: string | null;
  dba_names?: string[];
  entity_type?: CorporateEntityType | null;
  tax_classification?: string | null;
  ein?: string | null;
  formation_state?: string | null;
  formation_date?: string | null;
  sos_entity_number?: string | null;
  registered_agent_name?: string | null;
  registered_agent_address?: string | null;
  principal_address?: string | null;
  mailing_address?: string | null;
  fiscal_year_end?: string | null;
  naics_code?: string | null;
  duns_or_uei?: string | null;
  notes?: string | null;
}

export async function upsertCorporateProfile(
  input: UpsertCorporateProfileInput,
  actor?: AuditActor,
): Promise<{ ok: true; profile: CorporateProfile } | { ok: false; error: string }> {
  const client = supabase("upsertCorporateProfile");
  if (!client) return { ok: false, error: "Corporate info is not configured." };

  // Lengths here are generous on purpose: the format check, not truncation,
  // rejects "INDIANA" or "12-31-2020".
  const ein = input.ein === undefined ? undefined : trimOptionalText(input.ein, 64);
  if (ein && !isValidEin(ein)) {
    return { ok: false, error: "EIN must match ##-#######." };
  }

  const formationState =
    input.formation_state === undefined
      ? undefined
      : trimOptionalText(input.formation_state?.toUpperCase(), 64);
  if (formationState && !isValidUsState(formationState)) {
    return { ok: false, error: "formation_state must be a 2-letter US code." };
  }

  const fiscalYearEnd = input.fiscal_year_end === undefined ? undefined : trimOptionalText(input.fiscal_year_end, 64);
  if (fiscalYearEnd && !isValidFiscalYearEnd(fiscalYearEnd)) {
    return { ok: false, error: "fiscal_year_end must be MM-DD." };
  }

  if (input.entity_type !== undefined && input.entity_type !== null) {
    if (!CORPORATE_ENTITY_TYPES.includes(input.entity_type)) {
      return { ok: false, error: "Invalid entity_type." };
    }
  }

  const formationDate = input.formation_date === undefined ? undefined : trimOptionalText(input.formation_date, 64);
  if (formationDate && !parseIsoDateOnly(formationDate)) {
    return { ok: false, error: "formation_date must be YYYY-MM-DD." };
  }

  const payload: Record<string, unknown> = {
    singleton: true,
    updated_at: new Date().toISOString(),
  };

  if (input.legal_name !== undefined) payload.legal_name = trimOptionalText(input.legal_name, 512);
  if (input.dba_names !== undefined) {
    payload.dba_names = input.dba_names
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 32);
  }
  if (input.entity_type !== undefined) payload.entity_type = input.entity_type;
  if (input.tax_classification !== undefined) {
    payload.tax_classification = trimOptionalText(input.tax_classification, 128);
  }
  if (ein !== undefined) payload.ein = ein;
  if (formationState !== undefined) payload.formation_state = formationState;
  if (formationDate !== undefined) payload.formation_date = formationDate;
  if (input.sos_entity_number !== undefined) {
    payload.sos_entity_number = trimOptionalText(input.sos_entity_number, 128);
  }
  if (input.registered_agent_name !== undefined) {
    payload.registered_agent_name = trimOptionalText(input.registered_agent_name, 256);
  }
  if (input.registered_agent_address !== undefined) {
    payload.registered_agent_address = trimOptionalText(input.registered_agent_address, 1024);
  }
  if (input.principal_address !== undefined) {
    payload.principal_address = trimOptionalText(input.principal_address, 1024);
  }
  if (input.mailing_address !== undefined) {
    payload.mailing_address = trimOptionalText(input.mailing_address, 1024);
  }
  if (fiscalYearEnd !== undefined) payload.fiscal_year_end = fiscalYearEnd;
  if (input.naics_code !== undefined) payload.naics_code = trimOptionalText(input.naics_code, 32);
  if (input.duns_or_uei !== undefined) payload.duns_or_uei = trimOptionalText(input.duns_or_uei, 64);
  if (input.notes !== undefined) payload.notes = trimOptionalText(input.notes, 8000);
  payload.updated_by = actor?.actor_id ?? null;

  const before = await client.from("corporate_profile").select("*").maybeSingle();
  if (before.error) {
    warnSupabase("Corporate", "upsertCorporateProfile", before.error);
    return { ok: false, error: "Could not load corporate profile." };
  }

  const { data, error } = await client
    .from("corporate_profile")
    .upsert(payload, { onConflict: "singleton" })
    .select("*")
    .single();

  if (error || !data) {
    warnSupabase("Corporate", "upsertCorporateProfile", error);
    return { ok: false, error: "Could not save corporate profile." };
  }

  const profile = mapProfile(data as Row);
  if (!profile) return { ok: false, error: "Could not save corporate profile." };

  await audit(actor, {
    action: before.data ? "corporate.profile_updated" : "corporate.profile_created",
    resource_type: "corporate_profile",
    resource_id: "singleton",
    before: before.data ?? null,
    after: data,
  });

  return { ok: true, profile };
}

export interface UpsertRegistrationInput {
  id?: string;
  jurisdiction: string;
  kind: RegistrationKind;
  label: string;
  identifier?: string | null;
  agency_name?: string | null;
  portal_url?: string | null;
  onepassword_ref?: string | null;
  effective_date?: string | null;
  status?: RegistrationStatus;
  notes?: string | null;
}

export async function upsertCorporateRegistration(
  input: UpsertRegistrationInput,
  actor?: AuditActor,
): Promise<{ ok: true; registration: CorporateRegistration } | { ok: false; error: string }> {
  const client = supabase("upsertCorporateRegistration");
  if (!client) return { ok: false, error: "Corporate info is not configured." };

  const jurisdiction = trimOptionalText(input.jurisdiction, 64);
  const label = trimOptionalText(input.label, 256);
  if (!jurisdiction || !label) return { ok: false, error: "jurisdiction and label are required." };
  if (!REGISTRATION_KINDS.includes(input.kind)) return { ok: false, error: "Invalid registration kind." };

  const status = input.status ?? "active";
  if (!REGISTRATION_STATUSES.includes(status)) return { ok: false, error: "Invalid registration status." };

  const portalUrl = input.portal_url === undefined ? undefined : trimOptionalText(input.portal_url, 2048);
  if (portalUrl && !isValidHttpUrl(portalUrl)) {
    return { ok: false, error: "portal_url must be http or https." };
  }

  const opRef =
    input.onepassword_ref === undefined ? undefined : trimOptionalText(input.onepassword_ref, 512);
  if (opRef && !isValidOnepasswordRef(opRef)) {
    return { ok: false, error: "onepassword_ref must start with op://." };
  }

  const effectiveDate =
    input.effective_date === undefined ? undefined : trimOptionalText(input.effective_date, 64);
  if (effectiveDate && !parseIsoDateOnly(effectiveDate)) {
    return { ok: false, error: "effective_date must be YYYY-MM-DD." };
  }

  // Optional fields are written only when sent, so an edit form that omits a
  // field (agency, notes, effective date) does not erase it.
  const payload: Record<string, unknown> = {
    jurisdiction,
    kind: input.kind,
    label,
    status,
    updated_at: new Date().toISOString(),
  };
  if (input.identifier !== undefined) payload.identifier = trimOptionalText(input.identifier, 256);
  if (input.agency_name !== undefined) payload.agency_name = trimOptionalText(input.agency_name, 256);
  if (portalUrl !== undefined) payload.portal_url = portalUrl;
  if (opRef !== undefined) payload.onepassword_ref = opRef;
  if (effectiveDate !== undefined) payload.effective_date = effectiveDate;
  if (input.notes !== undefined) payload.notes = trimOptionalText(input.notes, 8000);

  let before: Row | null = null;
  if (input.id) {
    const existing = await client.from("corporate_registrations").select("*").eq("id", input.id).maybeSingle();
    if (existing.error) {
      warnSupabase("Corporate", "upsertCorporateRegistration", existing.error);
      return { ok: false, error: "Could not load registration." };
    }
    before = (existing.data as Row | null) ?? null;
    payload.id = input.id;
  }

  const query = input.id
    ? client.from("corporate_registrations").update(payload).eq("id", input.id)
    : client.from("corporate_registrations").insert(payload);

  const { data, error } = await query.select("*").single();
  if (error || !data) {
    warnSupabase("Corporate", "upsertCorporateRegistration", error);
    return { ok: false, error: "Could not save registration." };
  }

  await audit(actor, {
    action: before ? "corporate.registration_updated" : "corporate.registration_created",
    resource_type: "corporate_registration",
    resource_id: String(data.id),
    before,
    after: data,
  });

  return { ok: true, registration: mapRegistration(data as Row) };
}

export async function deleteCorporateRegistration(
  id: string,
  actor?: AuditActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = supabase("deleteCorporateRegistration");
  if (!client) return { ok: false, error: "Corporate info is not configured." };

  const existing = await client.from("corporate_registrations").select("*").eq("id", id).maybeSingle();
  if (existing.error || !existing.data) {
    return { ok: false, error: "Registration not found." };
  }

  const { error } = await client.from("corporate_registrations").delete().eq("id", id);
  if (error) {
    warnSupabase("Corporate", "deleteCorporateRegistration", error);
    return { ok: false, error: "Could not delete registration." };
  }

  await audit(actor, {
    action: "corporate.registration_deleted",
    resource_type: "corporate_registration",
    resource_id: id,
    before: existing.data,
    after: null,
  });

  return { ok: true };
}

export interface UpsertFilingInput {
  id?: string;
  registration_id?: string | null;
  jurisdiction: string;
  name: string;
  frequency: FilingFrequency;
  next_due_date?: string | null;
  last_filed_date?: string | null;
  last_confirmation?: string | null;
  portal_url?: string | null;
  notes?: string | null;
}

export async function upsertCorporateFiling(
  input: UpsertFilingInput,
  actor?: AuditActor,
): Promise<{ ok: true; filing: CorporateFiling } | { ok: false; error: string }> {
  const client = supabase("upsertCorporateFiling");
  if (!client) return { ok: false, error: "Corporate info is not configured." };

  const jurisdiction = trimOptionalText(input.jurisdiction, 64);
  const name = trimOptionalText(input.name, 256);
  if (!jurisdiction || !name) return { ok: false, error: "jurisdiction and name are required." };
  if (!FILING_FREQUENCIES.includes(input.frequency)) return { ok: false, error: "Invalid frequency." };

  const portalUrl = input.portal_url === undefined ? undefined : trimOptionalText(input.portal_url, 2048);
  if (portalUrl && !isValidHttpUrl(portalUrl)) {
    return { ok: false, error: "portal_url must be http or https." };
  }

  const nextDue =
    input.next_due_date === undefined ? undefined : trimOptionalText(input.next_due_date, 64);
  if (nextDue && !parseIsoDateOnly(nextDue)) {
    return { ok: false, error: "next_due_date must be YYYY-MM-DD." };
  }

  const lastFiled =
    input.last_filed_date === undefined ? undefined : trimOptionalText(input.last_filed_date, 64);
  if (lastFiled && !parseIsoDateOnly(lastFiled)) {
    return { ok: false, error: "last_filed_date must be YYYY-MM-DD." };
  }

  // Optional fields are written only when sent, so an edit that omits
  // last_filed_date or last_confirmation does not erase the filing history.
  const payload: Record<string, unknown> = {
    jurisdiction,
    name,
    frequency: input.frequency,
    updated_at: new Date().toISOString(),
  };
  if (input.registration_id !== undefined) payload.registration_id = input.registration_id;
  if (nextDue !== undefined) payload.next_due_date = nextDue;
  if (lastFiled !== undefined) payload.last_filed_date = lastFiled;
  if (input.last_confirmation !== undefined) {
    payload.last_confirmation = trimOptionalText(input.last_confirmation, 512);
  }
  if (portalUrl !== undefined) payload.portal_url = portalUrl;
  if (input.notes !== undefined) payload.notes = trimOptionalText(input.notes, 8000);

  let before: Row | null = null;
  if (input.id) {
    const existing = await client.from("corporate_filings").select("*").eq("id", input.id).maybeSingle();
    if (existing.error) {
      warnSupabase("Corporate", "upsertCorporateFiling", existing.error);
      return { ok: false, error: "Could not load filing." };
    }
    before = (existing.data as Row | null) ?? null;
    payload.id = input.id;
  }

  const query = input.id
    ? client.from("corporate_filings").update(payload).eq("id", input.id)
    : client.from("corporate_filings").insert(payload);

  const { data, error } = await query.select("*").single();
  if (error || !data) {
    warnSupabase("Corporate", "upsertCorporateFiling", error);
    return { ok: false, error: "Could not save filing." };
  }

  await audit(actor, {
    action: before ? "corporate.filing_updated" : "corporate.filing_created",
    resource_type: "corporate_filing",
    resource_id: String(data.id),
    before,
    after: data,
  });

  return { ok: true, filing: mapFiling(data as Row) };
}

export async function markCorporateFilingFiled(
  id: string,
  options: { filedDate?: string; confirmation?: string | null } = {},
  actor?: AuditActor,
): Promise<{ ok: true; filing: CorporateFiling } | { ok: false; error: string }> {
  const client = supabase("markCorporateFilingFiled");
  if (!client) return { ok: false, error: "Corporate info is not configured." };

  const existing = await client.from("corporate_filings").select("*").eq("id", id).maybeSingle();
  if (existing.error || !existing.data) {
    return { ok: false, error: "Filing not found." };
  }

  const row = existing.data as Row;
  const frequency = row.frequency as FilingFrequency;
  const currentDue = (row.next_due_date as string | null) ?? null;
  // The UI sends the staff member's local date; the UTC fallback only covers
  // direct API callers.
  const filedDate =
    options.filedDate?.trim() ||
    new Date().toISOString().slice(0, 10);

  if (!parseIsoDateOnly(filedDate)) {
    return { ok: false, error: "filedDate must be YYYY-MM-DD." };
  }
  // One day of slack covers time zones ahead of UTC.
  if (filedDate > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) {
    return { ok: false, error: "filedDate cannot be in the future." };
  }

  // Each "mark filed" satisfies exactly one period, so a filing several periods
  // overdue stays overdue until each one is marked.
  const baseDue = currentDue ?? filedDate;
  const nextDue = advanceDueDate(baseDue, frequency);

  const payload = {
    last_filed_date: filedDate,
    last_confirmation:
      options.confirmation === undefined
        ? row.last_confirmation
        : trimOptionalText(options.confirmation, 512),
    next_due_date: nextDue,
    updated_at: new Date().toISOString(),
  };

  // Guard on the due date we read: a double click or a second tab must not
  // advance the same filing twice.
  const update = client.from("corporate_filings").update(payload).eq("id", id);
  const guarded = currentDue === null ? update.is("next_due_date", null) : update.eq("next_due_date", currentDue);
  const { data, error } = await guarded.select("*").maybeSingle();

  if (error) {
    warnSupabase("Corporate", "markCorporateFilingFiled", error);
    return { ok: false, error: "Could not mark filing as filed." };
  }
  if (!data) {
    return { ok: false, error: "Filing changed since it was loaded. Reload and try again." };
  }

  await audit(actor, {
    action: "corporate.filing_marked_filed",
    resource_type: "corporate_filing",
    resource_id: id,
    before: row,
    after: data,
  });

  return { ok: true, filing: mapFiling(data as Row) };
}

export async function deleteCorporateFiling(
  id: string,
  actor?: AuditActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = supabase("deleteCorporateFiling");
  if (!client) return { ok: false, error: "Corporate info is not configured." };

  const existing = await client.from("corporate_filings").select("*").eq("id", id).maybeSingle();
  if (existing.error || !existing.data) {
    return { ok: false, error: "Filing not found." };
  }

  const { error } = await client.from("corporate_filings").delete().eq("id", id);
  if (error) {
    warnSupabase("Corporate", "deleteCorporateFiling", error);
    return { ok: false, error: "Could not delete filing." };
  }

  await audit(actor, {
    action: "corporate.filing_deleted",
    resource_type: "corporate_filing",
    resource_id: id,
    before: existing.data,
    after: null,
  });

  return { ok: true };
}

export interface UploadCorporateDocumentInput {
  file: File;
  doc_type: CorporateDocType;
  registration_id?: string | null;
}

export async function uploadCorporateDocument(
  input: UploadCorporateDocumentInput,
  actor?: AuditActor,
): Promise<{ ok: true; document: CorporateSnapshot["documents"][number] } | { ok: false; error: string }> {
  const client = supabase("uploadCorporateDocument");
  if (!client) return { ok: false, error: "Corporate info is not configured." };

  if (!CORPORATE_DOC_TYPES.includes(input.doc_type)) {
    return { ok: false, error: "Invalid doc_type." };
  }

  const mimeType = input.file.type || "application/octet-stream";
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: "File type is not allowed." };
  }

  if (input.file.size < 1 || input.file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "File must be between 1 byte and 4 MB." };
  }

  const storagePath = `${randomUUID()}`;
  const buffer = Buffer.from(await input.file.arrayBuffer());

  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    warnSupabase("Corporate", "uploadCorporateDocument", uploadError);
    return { ok: false, error: "Could not upload document." };
  }

  const fileName = input.file.name.trim().slice(0, 255) || "document";
  const { data, error } = await client
    .from("corporate_documents")
    .insert({
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: input.file.size,
      doc_type: input.doc_type,
      registration_id: input.registration_id ?? null,
      uploaded_by: actor?.actor_id ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    await client.storage.from(BUCKET).remove([storagePath]);
    warnSupabase("Corporate", "uploadCorporateDocument", error);
    return { ok: false, error: "Could not save document metadata." };
  }

  await audit(actor, {
    action: "corporate.document_uploaded",
    resource_type: "corporate_document",
    resource_id: String(data.id),
    after: data,
  });

  return {
    ok: true,
    document: {
      id: String(data.id),
      storage_path: String(data.storage_path),
      file_name: String(data.file_name),
      mime_type: String(data.mime_type),
      size_bytes: Number(data.size_bytes),
      doc_type: data.doc_type as CorporateDocType,
      registration_id: (data.registration_id as string | null) ?? null,
      uploaded_by: (data.uploaded_by as string | null) ?? null,
      created_at: String(data.created_at),
    },
  };
}

export async function deleteCorporateDocument(
  id: string,
  actor?: AuditActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = supabase("deleteCorporateDocument");
  if (!client) return { ok: false, error: "Corporate info is not configured." };

  const existing = await client.from("corporate_documents").select("*").eq("id", id).maybeSingle();
  if (existing.error || !existing.data) {
    return { ok: false, error: "Document not found." };
  }

  const row = existing.data as Row;
  const storagePath = String(row.storage_path);

  const { error } = await client.from("corporate_documents").delete().eq("id", id);
  if (error) {
    warnSupabase("Corporate", "deleteCorporateDocument", error);
    return { ok: false, error: "Could not delete document." };
  }

  const removed = await client.storage.from(BUCKET).remove([storagePath]);
  if (removed.error) {
    // The row is gone either way; log the orphaned object path for cleanup.
    warnSupabase("Corporate", `deleteCorporateDocument orphan ${storagePath}`, removed.error);
  }

  await audit(actor, {
    action: "corporate.document_deleted",
    resource_type: "corporate_document",
    resource_id: id,
    before: row,
    after: null,
  });

  return { ok: true };
}

export async function getCorporateDocumentDownloadUrl(
  id: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const client = supabase("getCorporateDocumentDownloadUrl");
  if (!client) return { ok: false, error: "Corporate info is not configured." };

  const { data, error } = await client
    .from("corporate_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Document not found." };

  const signed = await client.storage
    .from(BUCKET)
    .createSignedUrl(String(data.storage_path), SIGNED_URL_TTL);

  if (signed.error || !signed.data?.signedUrl) {
    warnSupabase("Corporate", "getCorporateDocumentDownloadUrl", signed.error);
    return { ok: false, error: "Could not create download link." };
  }

  return { ok: true, url: signed.data.signedUrl };
}
