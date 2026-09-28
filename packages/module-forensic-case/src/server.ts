import "server-only";

import { recordAudit } from "@waltersignal/bananaforce-data-supabase/audit";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
} from "@waltersignal/bananaforce-module-crm/cursor";
import type {
  Address,
  AddressInput,
  CaseClaimant,
  CaseEvidence,
  CaseParticipant,
  CaseTimeEntry,
  ClaimantInput,
  ContactMethod,
  ContactMethodInput,
  Deposition,
  DepositionInput,
  EvidenceInput,
  ForensicEntity,
  ForensicInputMap,
  ForensicRecordBase,
  ForensicRecordMap,
  ParticipantInput,
  TimeEntryInput,
} from "./types";

type ForensicRow = Record<string, unknown>;

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
export const MAX_NAME = 255;
export const MAX_TEXT = 2000;

const MODULE_LABEL = "Forensic case";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EntityConfig {
  table: string;
  writable: readonly string[];
  search: readonly string[];
  filters: readonly string[];
}

const LEGACY_FIELDS = ["legacy_id", "source_system"] as const;

const ENTITY_CONFIG = {
  evidence: {
    table: "case_evidence",
    writable: [
      "case_id",
      "legacy_case_ref",
      "description",
      "piece_count",
      "received_on",
      "report_on",
      "action",
      "action_on",
      "disposition_on",
      "disposition_method",
      "custodian_initials",
      "storage_location",
      "other_location",
      "response",
      "results",
      "returned_to",
      "xray_status",
      "xray_on",
      "work_order_reference",
      ...LEGACY_FIELDS,
    ],
    search: ["description", "results", "work_order_reference", "legacy_case_ref"],
    filters: ["case_id"],
  },
  claimants: {
    table: "case_claimants",
    writable: [
      "case_id",
      "legacy_case_ref",
      "display_name",
      "first_name",
      "last_name",
      "status",
      "address_line_1",
      "address_line_2",
      "city",
      "state",
      "postal_code",
      "loss_date",
      "email",
      "cell_phone",
      "home_phone",
      "work_phone",
      "work_extension",
      "instructions",
      ...LEGACY_FIELDS,
    ],
    search: ["display_name", "first_name", "last_name", "email"],
    filters: ["case_id"],
  },
  addresses: {
    table: "addresses",
    writable: [
      "account_id",
      "contact_id",
      "case_id",
      "legacy_account_ref",
      "legacy_contact_ref",
      "legacy_expert_ref",
      "category",
      "line_1",
      "formatted_address",
      "city",
      "state",
      "postal_code",
      ...LEGACY_FIELDS,
    ],
    search: ["line_1", "formatted_address", "city", "postal_code"],
    filters: ["account_id", "contact_id", "case_id"],
  },
  contact_methods: {
    table: "contact_methods",
    writable: [
      "kind",
      "contact_id",
      "account_id",
      "legacy_contact_ref",
      "legacy_account_ref",
      "label",
      "value",
      "extension",
      "is_primary",
      ...LEGACY_FIELDS,
    ],
    search: ["value", "label"],
    filters: ["contact_id", "account_id", "kind"],
  },
  participants: {
    table: "case_participants",
    writable: [
      "participant_type",
      "case_id",
      "contact_id",
      "account_id",
      "legacy_case_ref",
      "legacy_contact_ref",
      "legacy_account_ref",
      "role",
      "notes",
      ...LEGACY_FIELDS,
    ],
    search: ["role", "notes", "legacy_contact_ref", "legacy_account_ref"],
    filters: ["case_id", "contact_id", "account_id", "participant_type"],
  },
  depositions: {
    table: "depositions",
    writable: [
      "case_id",
      "legacy_case_ref",
      "deponent",
      "scheduled_on",
      "description",
      "display_text",
      "location",
      ...LEGACY_FIELDS,
    ],
    search: ["deponent", "description", "display_text", "location"],
    filters: ["case_id"],
  },
  time_entries: {
    table: "case_time_entries",
    writable: [
      "case_id",
      "staff_id",
      "legacy_case_ref",
      "legacy_staff_ref",
      "entry_date",
      "category",
      "description",
      "hours",
      "hourly_rate",
      "multiplier",
      "invoice_number",
      "location",
      "billed_amount",
      ...LEGACY_FIELDS,
    ],
    search: ["description", "invoice_number", "category", "legacy_case_ref"],
    filters: ["case_id", "staff_id"],
  },
} as const satisfies Record<ForensicEntity, EntityConfig>;

export interface ListPage<T> {
  rows: T[];
  nextCursor: string | null;
}

export interface ForensicListOptions {
  limit?: number | null;
  cursor?: string | null;
  search?: string | null;
  caseId?: string | null;
  contactId?: string | null;
  accountId?: string | null;
  staffId?: string | null;
  kind?: "phone" | "email" | null;
  participantType?: "expert" | "attorney" | "contact" | null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function commonFromRow(row: ForensicRow): ForensicRecordBase {
  return {
    id: stringOrNull(row.id) ?? "",
    legacy_id: stringOrNull(row.legacy_id),
    source_system: stringOrNull(row.source_system),
    created_at: stringOrNull(row.created_at) ?? "",
    updated_at: stringOrNull(row.updated_at) ?? "",
    deleted_at: stringOrNull(row.deleted_at),
  };
}

function recordFromRow<E extends ForensicEntity>(
  entity: E,
  row: ForensicRow,
): ForensicRecordMap[E] {
  const common = commonFromRow(row);

  if (entity === "evidence") {
    return {
      ...common,
      case_id: stringOrNull(row.case_id),
      legacy_case_ref: stringOrNull(row.legacy_case_ref),
      description: stringOrNull(row.description),
      piece_count: stringOrNull(row.piece_count),
      received_on: stringOrNull(row.received_on),
      report_on: stringOrNull(row.report_on),
      action: stringOrNull(row.action),
      action_on: stringOrNull(row.action_on),
      disposition_on: stringOrNull(row.disposition_on),
      disposition_method: stringOrNull(row.disposition_method),
      custodian_initials: stringOrNull(row.custodian_initials),
      storage_location: stringOrNull(row.storage_location),
      other_location: stringOrNull(row.other_location),
      response: stringOrNull(row.response),
      results: stringOrNull(row.results),
      returned_to: stringOrNull(row.returned_to),
      xray_status: stringOrNull(row.xray_status),
      xray_on: stringOrNull(row.xray_on),
      work_order_reference: stringOrNull(row.work_order_reference),
    } as ForensicRecordMap[E];
  }

  if (entity === "claimants") {
    return {
      ...common,
      case_id: stringOrNull(row.case_id) ?? "",
      legacy_case_ref: stringOrNull(row.legacy_case_ref),
      display_name: stringOrNull(row.display_name),
      first_name: stringOrNull(row.first_name),
      last_name: stringOrNull(row.last_name),
      status: stringOrNull(row.status),
      address_line_1: stringOrNull(row.address_line_1),
      address_line_2: stringOrNull(row.address_line_2),
      city: stringOrNull(row.city),
      state: stringOrNull(row.state),
      postal_code: stringOrNull(row.postal_code),
      loss_date: stringOrNull(row.loss_date),
      email: stringOrNull(row.email),
      cell_phone: stringOrNull(row.cell_phone),
      home_phone: stringOrNull(row.home_phone),
      work_phone: stringOrNull(row.work_phone),
      work_extension: stringOrNull(row.work_extension),
      instructions: stringOrNull(row.instructions),
    } as ForensicRecordMap[E];
  }

  if (entity === "addresses") {
    return {
      ...common,
      account_id: stringOrNull(row.account_id),
      contact_id: stringOrNull(row.contact_id),
      case_id: stringOrNull(row.case_id),
      legacy_account_ref: stringOrNull(row.legacy_account_ref),
      legacy_contact_ref: stringOrNull(row.legacy_contact_ref),
      legacy_expert_ref: stringOrNull(row.legacy_expert_ref),
      category: stringOrNull(row.category),
      line_1: stringOrNull(row.line_1),
      formatted_address: stringOrNull(row.formatted_address),
      city: stringOrNull(row.city),
      state: stringOrNull(row.state),
      postal_code: stringOrNull(row.postal_code),
    } as ForensicRecordMap[E];
  }

  if (entity === "contact_methods") {
    return {
      ...common,
      kind: row.kind === "email" ? "email" : "phone",
      contact_id: stringOrNull(row.contact_id),
      account_id: stringOrNull(row.account_id),
      legacy_contact_ref: stringOrNull(row.legacy_contact_ref),
      legacy_account_ref: stringOrNull(row.legacy_account_ref),
      label: stringOrNull(row.label),
      value: stringOrNull(row.value),
      extension: stringOrNull(row.extension),
      is_primary: row.is_primary === true,
    } as ForensicRecordMap[E];
  }

  if (entity === "participants") {
    const type = stringOrNull(row.participant_type);
    return {
      ...common,
      participant_type:
        type === "attorney" || type === "contact" ? type : "expert",
      case_id: stringOrNull(row.case_id),
      contact_id: stringOrNull(row.contact_id),
      account_id: stringOrNull(row.account_id),
      legacy_case_ref: stringOrNull(row.legacy_case_ref),
      legacy_contact_ref: stringOrNull(row.legacy_contact_ref),
      legacy_account_ref: stringOrNull(row.legacy_account_ref),
      role: stringOrNull(row.role),
      notes: stringOrNull(row.notes),
    } as ForensicRecordMap[E];
  }

  if (entity === "depositions") {
    return {
      ...common,
      case_id: stringOrNull(row.case_id),
      legacy_case_ref: stringOrNull(row.legacy_case_ref),
      deponent: stringOrNull(row.deponent),
      scheduled_on: stringOrNull(row.scheduled_on),
      description: stringOrNull(row.description),
      display_text: stringOrNull(row.display_text),
      location: stringOrNull(row.location),
    } as ForensicRecordMap[E];
  }

  return {
    ...common,
    case_id: stringOrNull(row.case_id) ?? "",
    staff_id: stringOrNull(row.staff_id),
    legacy_case_ref: stringOrNull(row.legacy_case_ref),
    legacy_staff_ref: stringOrNull(row.legacy_staff_ref),
    entry_date: stringOrNull(row.entry_date),
    category: stringOrNull(row.category),
    description: stringOrNull(row.description),
    hours: numberOrNull(row.hours) ?? 0,
    hourly_rate: numberOrNull(row.hourly_rate),
    multiplier: numberOrNull(row.multiplier),
    invoice_number: stringOrNull(row.invoice_number),
    location: stringOrNull(row.location),
    billed_amount: numberOrNull(row.billed_amount),
  } as ForensicRecordMap[E];
}

function normalizeLimit(limit: number | null | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
}

function normalizeSearch(search: string | null | undefined): string | null {
  if (!search) return null;
  const trimmed = search.trim().slice(0, MAX_NAME);
  return trimmed.length > 0 ? trimmed : null;
}

function ilikeContainsPattern(value: string): string {
  const safe = value.replace(/[(),]/g, " ").replace(/[\\%_]/g, "\\$&");
  return `%${safe}%`;
}

function emptyPage<E extends ForensicEntity>(): ListPage<ForensicRecordMap[E]> {
  return { rows: [], nextCursor: null };
}

function keysetFilter(cursor: { createdAt: string; id: string }): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

function pickWritable<E extends ForensicEntity>(
  entity: E,
  input: ForensicInputMap[E],
): ForensicRow {
  const source = input as ForensicRow;
  const payload: ForensicRow = {};
  for (const field of ENTITY_CONFIG[entity].writable) {
    if (source[field] !== undefined) payload[field] = source[field];
  }
  return payload;
}

function optionFilters(options: ForensicListOptions): Record<string, string> | null {
  const pairs: [string, string | null | undefined][] = [
    ["case_id", options.caseId],
    ["contact_id", options.contactId],
    ["account_id", options.accountId],
    ["staff_id", options.staffId],
  ];
  const filters: Record<string, string> = {};
  for (const [column, value] of pairs) {
    if (value && !isUuid(value)) return null;
    if (value) filters[column] = value;
  }
  if (options.kind) filters.kind = options.kind;
  if (options.participantType) filters.participant_type = options.participantType;
  return filters;
}

async function audit(
  client: Parameters<typeof recordAudit>[0],
  action: "create" | "update" | "soft_delete",
  entity: ForensicEntity,
  record: unknown,
  before?: unknown,
): Promise<void> {
  const id =
    record && typeof record === "object" && "id" in record
      ? String((record as { id: unknown }).id)
      : null;
  await recordAudit(client, {
    action,
    resource_type: `forensic_case_${entity}`,
    resource_id: id,
    before,
    after: record,
  });
}

export function isForensicCaseConfigured(): boolean {
  return isServiceRoleConfigured();
}

export async function listForensicRecords<E extends ForensicEntity>(
  entity: E,
  options: ForensicListOptions = {},
): Promise<ListPage<ForensicRecordMap[E]>> {
  const supabase = getServiceClientOrNull(MODULE_LABEL, `list:${entity}`);
  if (!supabase) return emptyPage();

  const filters = optionFilters(options);
  if (!filters) return emptyPage();
  const config = ENTITY_CONFIG[entity];
  const allowedFilters = new Set<string>(config.filters);
  if (Object.keys(filters).some((field) => !allowedFilters.has(field))) {
    return emptyPage();
  }

  const limit = normalizeLimit(options.limit);
  let query = supabase.from(config.table).select("*").is("deleted_at", null);
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }

  const search = normalizeSearch(options.search);
  if (search) {
    const pattern = ilikeContainsPattern(search);
    query = query.or(config.search.map((column) => `${column}.ilike.${pattern}`).join(","));
  }

  const cursor = decodeKeysetCursor(options.cursor);
  if (cursor) query = query.or(keysetFilter(cursor));
  query = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;
  if (error) {
    warnSupabase(MODULE_LABEL, `list:${entity}`, error);
    return emptyPage();
  }

  const rows = (data ?? []) as ForensicRow[];
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const createdAt = last ? stringOrNull(last.created_at) : null;
  const id = last ? stringOrNull(last.id) : null;
  return {
    rows: pageRows.map((row) => recordFromRow(entity, row)),
    nextCursor:
      rows.length > limit && createdAt && id
        ? encodeKeysetCursor({ createdAt, id })
        : null,
  };
}

export async function getForensicRecord<E extends ForensicEntity>(
  entity: E,
  id: string,
): Promise<ForensicRecordMap[E] | null> {
  if (!isUuid(id)) return null;
  const supabase = getServiceClientOrNull(MODULE_LABEL, `get:${entity}`);
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(ENTITY_CONFIG[entity].table)
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    warnSupabase(MODULE_LABEL, `get:${entity}`, error);
    return null;
  }
  return data ? recordFromRow(entity, data as ForensicRow) : null;
}

export async function createForensicRecord<E extends ForensicEntity>(
  entity: E,
  input: ForensicInputMap[E],
): Promise<ForensicRecordMap[E] | null> {
  const supabase = getServiceClientOrNull(MODULE_LABEL, `create:${entity}`);
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(ENTITY_CONFIG[entity].table)
    .insert(pickWritable(entity, input))
    .select("*")
    .single();
  if (error) {
    warnSupabase(MODULE_LABEL, `create:${entity}`, error);
    return null;
  }
  if (!data) return null;
  const record = recordFromRow(entity, data as ForensicRow);
  await audit(supabase, "create", entity, record);
  return record;
}

export async function patchForensicRecord<E extends ForensicEntity>(
  entity: E,
  id: string,
  input: ForensicInputMap[E],
): Promise<ForensicRecordMap[E] | null> {
  if (!isUuid(id)) return null;
  const supabase = getServiceClientOrNull(MODULE_LABEL, `patch:${entity}`);
  if (!supabase) return null;

  const before = await getForensicRecord(entity, id);
  if (!before) return null;
  const patch = pickWritable(entity, input);
  if (Object.keys(patch).length === 0) return before;

  const { data, error } = await supabase
    .from(ENTITY_CONFIG[entity].table)
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();
  if (error) {
    warnSupabase(MODULE_LABEL, `patch:${entity}`, error);
    return null;
  }
  if (!data) return null;
  const record = recordFromRow(entity, data as ForensicRow);
  await audit(supabase, "update", entity, record, before);
  return record;
}

export async function softDeleteForensicRecord<E extends ForensicEntity>(
  entity: E,
  id: string,
): Promise<ForensicRecordMap[E] | null> {
  if (!isUuid(id)) return null;
  const supabase = getServiceClientOrNull(MODULE_LABEL, `softDelete:${entity}`);
  if (!supabase) return null;

  const before = await getForensicRecord(entity, id);
  if (!before) return null;
  const { data, error } = await supabase
    .from(ENTITY_CONFIG[entity].table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();
  if (error) {
    warnSupabase(MODULE_LABEL, `softDelete:${entity}`, error);
    return null;
  }
  if (!data) return null;
  const record = recordFromRow(entity, data as ForensicRow);
  await audit(supabase, "soft_delete", entity, record, before);
  return record;
}

// Explicit per-entity data functions keep imports discoverable while sharing
// the same audited, keyset-paginated implementation.
export const listEvidence = (options?: ForensicListOptions) =>
  listForensicRecords("evidence", options);
export const getEvidence = (id: string) => getForensicRecord("evidence", id);
export const createEvidence = (input: EvidenceInput) =>
  createForensicRecord("evidence", input);
export const patchEvidence = (id: string, input: EvidenceInput) =>
  patchForensicRecord("evidence", id, input);
export const softDeleteEvidence = (id: string) =>
  softDeleteForensicRecord("evidence", id);

export const listClaimants = (options?: ForensicListOptions) =>
  listForensicRecords("claimants", options);
export const getClaimant = (id: string) => getForensicRecord("claimants", id);
export const createClaimant = (input: ClaimantInput) =>
  createForensicRecord("claimants", input);
export const patchClaimant = (id: string, input: ClaimantInput) =>
  patchForensicRecord("claimants", id, input);
export const softDeleteClaimant = (id: string) =>
  softDeleteForensicRecord("claimants", id);

export const listAddresses = (options?: ForensicListOptions) =>
  listForensicRecords("addresses", options);
export const getAddress = (id: string) => getForensicRecord("addresses", id);
export const createAddress = (input: AddressInput) =>
  createForensicRecord("addresses", input);
export const patchAddress = (id: string, input: AddressInput) =>
  patchForensicRecord("addresses", id, input);
export const softDeleteAddress = (id: string) =>
  softDeleteForensicRecord("addresses", id);

export const listContactMethods = (options?: ForensicListOptions) =>
  listForensicRecords("contact_methods", options);
export const getContactMethod = (id: string) =>
  getForensicRecord("contact_methods", id);
export const createContactMethod = (input: ContactMethodInput) =>
  createForensicRecord("contact_methods", input);
export const patchContactMethod = (id: string, input: ContactMethodInput) =>
  patchForensicRecord("contact_methods", id, input);
export const softDeleteContactMethod = (id: string) =>
  softDeleteForensicRecord("contact_methods", id);

export const listParticipants = (options?: ForensicListOptions) =>
  listForensicRecords("participants", options);
export const getParticipant = (id: string) =>
  getForensicRecord("participants", id);
export const createParticipant = (input: ParticipantInput) =>
  createForensicRecord("participants", input);
export const patchParticipant = (id: string, input: ParticipantInput) =>
  patchForensicRecord("participants", id, input);
export const softDeleteParticipant = (id: string) =>
  softDeleteForensicRecord("participants", id);

export const listDepositions = (options?: ForensicListOptions) =>
  listForensicRecords("depositions", options);
export const getDeposition = (id: string) => getForensicRecord("depositions", id);
export const createDeposition = (input: DepositionInput) =>
  createForensicRecord("depositions", input);
export const patchDeposition = (id: string, input: DepositionInput) =>
  patchForensicRecord("depositions", id, input);
export const softDeleteDeposition = (id: string) =>
  softDeleteForensicRecord("depositions", id);

export const listTimeEntries = (options?: ForensicListOptions) =>
  listForensicRecords("time_entries", options);
export const getTimeEntry = (id: string) => getForensicRecord("time_entries", id);
export const createTimeEntry = (input: TimeEntryInput) =>
  createForensicRecord("time_entries", input);
export const patchTimeEntry = (id: string, input: TimeEntryInput) =>
  patchForensicRecord("time_entries", id, input);
export const softDeleteTimeEntry = (id: string) =>
  softDeleteForensicRecord("time_entries", id);

export type {
  Address,
  CaseClaimant,
  CaseEvidence,
  CaseParticipant,
  CaseTimeEntry,
  ContactMethod,
  Deposition,
};
