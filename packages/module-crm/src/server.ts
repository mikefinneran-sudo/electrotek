// Service-role data access for the CRM module. CRM tables are staff/service-role
// managed, so reads and writes here use the service-role key, which bypasses
// RLS. Guard every call with isCrmConfigured() and degrade gracefully when env
// is missing.

import "server-only";
import { recordAudit } from "@waltersignal/bananaforce-data-supabase/audit";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import { decodeKeysetCursor, encodeKeysetCursor } from "./cursor";
import { escapeIlikePattern } from "./search";
import type {
  Account,
  Activity,
  ActivityType,
  Case,
  CaseStatus,
  Contact,
  CrmTask,
  CustomFields,
  DealContact,
  Opportunity,
  OpportunityStatus,
  Pipeline,
  PipelineStage,
} from "./types";
import { ACTIVITY_TYPES, CASE_STATUSES, OPPORTUNITY_STATUSES } from "./types";

type CrmRow = Record<string, unknown>;
type ServiceClient = NonNullable<ReturnType<typeof getServiceClientOrNull>>;

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const MAX_NAME = 255;
const MAX_TEXT = 2000;

// Defense-in-depth UUID guard at the data layer. routes.ts also validates ids
// from the wire, but malformed ids should never reach `.eq("id")`.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface ListPage<T> {
  rows: T[];
  nextCursor: string | null;
}

export interface KeysetListOptions {
  limit?: number | null;
  cursor?: string | null;
  search?: string | null;
}

export interface AccountInput {
  name?: string | null;
  domain?: string | null;
  industry?: string | null;
  notes?: string | null;
  custom_fields?: CustomFields | null;
}

export interface CaseInput {
  case_number?: string | null;
  account_id?: string | null;
  contact_id?: string | null;
  title?: string | null;
  status?: CaseStatus | null;
  case_type?: string | null;
  incident_date?: string | null;
  incident_location?: string | null;
  opened_on?: string | null;
  closed_on?: string | null;
  notes?: string | null;
  custom_fields?: CustomFields | null;
  legacy_id?: string | null;
  source_system?: string | null;
}

export interface ContactInput {
  account_id?: string | null;
  lead_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  custom_fields?: CustomFields | null;
}

export interface PipelineInput {
  name?: string | null;
  is_active?: boolean;
  order_index?: number | null;
}

export interface StageInput {
  pipeline_id?: string | null;
  name?: string | null;
  sort_order?: number | null;
  active?: boolean;
  probability_weight?: number | null;
  rotten_days?: number | null;
  required_fields?: unknown[] | null;
}

export interface OpportunityInput {
  account_id?: string | null;
  contact_id?: string | null;
  stage_id?: string | null;
  name?: string | null;
  amount?: number | null;
  close_date?: string | null;
  status?: OpportunityStatus;
  lost_reason?: string | null;
  custom_fields?: CustomFields | null;
}

export interface ActivityInput {
  opportunity_id?: string | null;
  contact_id?: string | null;
  account_id?: string | null;
  type: ActivityType;
  body?: string | null;
  occurred_at?: string | null;
}

export interface CrmTaskInput {
  opportunity_id?: string | null;
  contact_id?: string | null;
  title?: string | null;
  due_date?: string | null;
  done?: boolean;
}

export interface DealContactInput {
  deal_id: string;
  contact_id: string;
  role?: string | null;
  is_primary?: boolean;
}

const ACCOUNT_WRITABLE_FIELDS: readonly (keyof AccountInput)[] = [
  "name",
  "domain",
  "industry",
  "notes",
  "custom_fields",
];

const CASE_WRITABLE_FIELDS: readonly (keyof CaseInput)[] = [
  "case_number",
  "account_id",
  "contact_id",
  "title",
  "status",
  "case_type",
  "incident_date",
  "incident_location",
  "opened_on",
  "closed_on",
  "notes",
  "custom_fields",
  "legacy_id",
  "source_system",
];

const CONTACT_WRITABLE_FIELDS: readonly (keyof ContactInput)[] = [
  "account_id",
  "lead_id",
  "first_name",
  "last_name",
  "email",
  "phone",
  "title",
  "custom_fields",
];

const PIPELINE_WRITABLE_FIELDS: readonly (keyof PipelineInput)[] = [
  "name",
  "is_active",
  "order_index",
];

const STAGE_WRITABLE_FIELDS: readonly (keyof StageInput)[] = [
  "pipeline_id",
  "name",
  "sort_order",
  "active",
  "probability_weight",
  "rotten_days",
  "required_fields",
];

const OPPORTUNITY_WRITABLE_FIELDS: readonly (keyof OpportunityInput)[] = [
  "account_id",
  "contact_id",
  "stage_id",
  "name",
  "amount",
  "close_date",
  "status",
  "lost_reason",
  "custom_fields",
];

const TASK_WRITABLE_FIELDS: readonly (keyof CrmTaskInput)[] = [
  "opportunity_id",
  "contact_id",
  "title",
  "due_date",
  "done",
];

const DEAL_CONTACT_WRITABLE_FIELDS: readonly (keyof Pick<
  DealContactInput,
  "role" | "is_primary"
>)[] = ["role", "is_primary"];

const MODULE_LABEL = "CRM";

const warn = (operation: string, error: unknown) =>
  warnSupabase(MODULE_LABEL, operation, error);

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function boolOrFalse(value: unknown): boolean {
  return value === true;
}

function jsonObjectOrEmpty(value: unknown): CustomFields {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as CustomFields;
  }
  return {};
}

function jsonArrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function statusOrOpen(value: unknown): OpportunityStatus {
  return OPPORTUNITY_STATUSES.includes(value as OpportunityStatus)
    ? (value as OpportunityStatus)
    : "open";
}

function activityTypeOrNote(value: unknown): ActivityType {
  return ACTIVITY_TYPES.includes(value as ActivityType) ? (value as ActivityType) : "note";
}

function normalizeLimit(limit: number | null | undefined): number {
  if (!Number.isFinite(limit) || limit == null) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
}

function normalizeSearch(search: string | null | undefined): string | null {
  if (!search) return null;
  const trimmed = search.trim().slice(0, MAX_NAME);
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeOrValue(value: string): string {
  return value.replace(/[(),]/g, " ");
}

function ilikeContainsPattern(value: string): string {
  return `%${escapeIlikePattern(value)}%`;
}

function emptyPage<T>(): ListPage<T> {
  return { rows: [], nextCursor: null };
}

function keysetFilter(cursor: { createdAt: string; id: string }): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

function pageFromRows<T>(
  rows: CrmRow[],
  limit: number,
  mapper: (row: CrmRow) => T,
): ListPage<T> {
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows.at(-1);
  const lastCreatedAt = lastRow ? stringOrNull(lastRow.created_at) : null;
  const lastId = lastRow ? stringOrNull(lastRow.id) : null;
  const nextCursor =
    rows.length > limit && lastCreatedAt && lastId
      ? encodeKeysetCursor({
          createdAt: lastCreatedAt,
          id: lastId,
        })
      : null;

  return {
    rows: pageRows.map(mapper),
    nextCursor,
  };
}

async function audit(
  client: Parameters<typeof recordAudit>[0],
  event: Parameters<typeof recordAudit>[1],
): Promise<void> {
  try {
    await recordAudit(client, event);
  } catch (error) {
    warn("audit", error);
  }
}

/**
 * Env-only check (no I/O). The service-role key is required for all CRM table
 * reads/writes; without it the module degrades to setup-required empties.
 */
export function isCrmConfigured(): boolean {
  return isServiceRoleConfigured();
}

const getServiceClient = (operation: string) =>
  getServiceClientOrNull(MODULE_LABEL, operation);

// --- row mappers ------------------------------------------------------------

function accountFromRow(row: CrmRow): Account {
  return {
    id: stringOrNull(row.id) ?? "",
    name: stringOrNull(row.name) ?? "",
    domain: stringOrNull(row.domain),
    industry: stringOrNull(row.industry),
    notes: stringOrNull(row.notes),
    custom_fields: jsonObjectOrEmpty(row.custom_fields),
    deleted_at: stringOrNull(row.deleted_at),
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function caseFromRow(row: CrmRow): Case {
  const status = stringOrNull(row.status);
  return {
    id: stringOrNull(row.id) ?? "",
    case_number: stringOrNull(row.case_number) ?? "",
    account_id: stringOrNull(row.account_id),
    contact_id: stringOrNull(row.contact_id),
    title: stringOrNull(row.title) ?? "",
    // Fall back rather than widen the type: a row that somehow holds an
    // unknown status still renders, and the CHECK constraint is what actually
    // guarantees the domain.
    status: (CASE_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as CaseStatus)
      : "open",
    case_type: stringOrNull(row.case_type),
    incident_date: stringOrNull(row.incident_date),
    incident_location: stringOrNull(row.incident_location),
    opened_on: stringOrNull(row.opened_on),
    closed_on: stringOrNull(row.closed_on),
    notes: stringOrNull(row.notes),
    custom_fields: jsonObjectOrEmpty(row.custom_fields),
    legacy_id: stringOrNull(row.legacy_id),
    source_system: stringOrNull(row.source_system),
    deleted_at: stringOrNull(row.deleted_at),
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function contactFromRow(row: CrmRow): Contact {
  return {
    id: stringOrNull(row.id) ?? "",
    account_id: stringOrNull(row.account_id),
    lead_id: stringOrNull(row.lead_id),
    first_name: stringOrNull(row.first_name),
    last_name: stringOrNull(row.last_name),
    email: stringOrNull(row.email),
    phone: stringOrNull(row.phone),
    title: stringOrNull(row.title),
    custom_fields: jsonObjectOrEmpty(row.custom_fields),
    deleted_at: stringOrNull(row.deleted_at),
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function pipelineFromRow(row: CrmRow): Pipeline {
  return {
    id: stringOrNull(row.id) ?? "",
    name: stringOrNull(row.name) ?? "",
    is_active: row.is_active !== false,
    order_index: numberOrNull(row.order_index) ?? 0,
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function stageFromRow(row: CrmRow): PipelineStage {
  return {
    id: stringOrNull(row.id) ?? "",
    pipeline_id: stringOrNull(row.pipeline_id),
    name: stringOrNull(row.name) ?? "",
    sort_order: numberOrNull(row.sort_order) ?? 0,
    is_won: boolOrFalse(row.is_won),
    is_lost: boolOrFalse(row.is_lost),
    active: row.active !== false,
    probability_weight: numberOrNull(row.probability_weight) ?? 0,
    rotten_days: numberOrNull(row.rotten_days),
    required_fields: jsonArrayOrEmpty(row.required_fields),
  };
}

function opportunityFromRow(row: CrmRow): Opportunity {
  return {
    id: stringOrNull(row.id) ?? "",
    account_id: stringOrNull(row.account_id),
    contact_id: stringOrNull(row.contact_id),
    stage_id: stringOrNull(row.stage_id),
    name: stringOrNull(row.name) ?? "",
    amount: numberOrNull(row.amount),
    close_date: stringOrNull(row.close_date),
    status: statusOrOpen(row.status),
    lost_reason: stringOrNull(row.lost_reason),
    custom_fields: jsonObjectOrEmpty(row.custom_fields),
    deleted_at: stringOrNull(row.deleted_at),
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function activityFromRow(row: CrmRow): Activity {
  return {
    id: stringOrNull(row.id) ?? "",
    opportunity_id: stringOrNull(row.opportunity_id),
    contact_id: stringOrNull(row.contact_id),
    account_id: stringOrNull(row.account_id),
    type: activityTypeOrNote(row.type),
    body: stringOrNull(row.body),
    occurred_at: stringOrNull(row.occurred_at) ?? new Date().toISOString(),
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

function taskFromRow(row: CrmRow): CrmTask {
  return {
    id: stringOrNull(row.id) ?? "",
    opportunity_id: stringOrNull(row.opportunity_id),
    contact_id: stringOrNull(row.contact_id),
    title: stringOrNull(row.title) ?? "",
    due_date: stringOrNull(row.due_date),
    done: boolOrFalse(row.done),
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function dealContactFromRow(row: CrmRow): DealContact {
  return {
    deal_id: stringOrNull(row.deal_id) ?? "",
    contact_id: stringOrNull(row.contact_id) ?? "",
    role: stringOrNull(row.role),
    is_primary: boolOrFalse(row.is_primary),
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

// --- pick writable fields ---------------------------------------------------

function pickAccountFields(input: AccountInput): CrmRow {
  const patch: CrmRow = {};
  for (const field of ACCOUNT_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

function pickCaseFields(input: CaseInput): CrmRow {
  const patch: CrmRow = {};
  for (const field of CASE_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

function pickContactFields(input: ContactInput): CrmRow {
  const patch: CrmRow = {};
  for (const field of CONTACT_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

function pickPipelineFields(input: PipelineInput): CrmRow {
  const patch: CrmRow = {};
  for (const field of PIPELINE_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

function pickStageFields(input: StageInput): CrmRow {
  const patch: CrmRow = {};
  for (const field of STAGE_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

function pickOpportunityFields(input: OpportunityInput): CrmRow {
  const patch: CrmRow = {};
  for (const field of OPPORTUNITY_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

function pickTaskFields(input: CrmTaskInput): CrmRow {
  const patch: CrmRow = {};
  for (const field of TASK_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

function pickDealContactFields(input: DealContactInput): CrmRow {
  const patch: CrmRow = {};
  for (const field of DEAL_CONTACT_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

// --- active keyset helpers --------------------------------------------------

function applyKeyset<T extends { or: (filters: string) => T }>(
  query: T,
  cursor?: string | null,
): T {
  const decoded = decodeKeysetCursor(cursor);
  return decoded ? query.or(keysetFilter(decoded)) : query;
}

function taskToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- deal-contact dual-write helpers ---------------------------------------

async function setLegacyPrimaryContact(
  supabase: ServiceClient,
  dealId: string,
  contactId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("crm_opportunities")
    .update({ contact_id: contactId })
    .eq("id", dealId)
    .is("deleted_at", null);
  if (error) warn("setLegacyPrimaryContact", error);
}

async function clearLegacyPrimaryContactIfMatches(
  supabase: ServiceClient,
  dealId: string,
  contactId: string,
): Promise<void> {
  const { error } = await supabase
    .from("crm_opportunities")
    .update({ contact_id: null })
    .eq("id", dealId)
    .eq("contact_id", contactId)
    .is("deleted_at", null);
  if (error) warn("clearLegacyPrimaryContactIfMatches", error);
}

async function ensurePrimaryDealContact(
  supabase: ServiceClient,
  dealId: string,
  contactId: string,
  role?: string | null,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("crm_set_primary_deal_contact", {
    p_deal: dealId,
    p_contact: contactId,
    p_role: role ?? null,
  });
  if (error) {
    warn("ensurePrimaryDealContact", error);
    return false;
  }
  return data === true;
}

async function clearPrimaryDealContacts(
  supabase: ServiceClient,
  dealId: string,
): Promise<void> {
  const { error } = await supabase
    .from("crm_deal_contacts")
    .update({ is_primary: false })
    .eq("deal_id", dealId)
    .eq("is_primary", true);
  if (error) warn("clearPrimaryDealContacts", error);

  await setLegacyPrimaryContact(supabase, dealId, null);
}

// --- accounts ---------------------------------------------------------------

// Exact (not "contains") case-insensitive match for dedupe lookups, as
// opposed to ilikeContainsPattern's wildcard search-as-you-type matches.
function ilikeExactValue(value: string): string {
  return escapeIlikePattern(sanitizeOrValue(value).trim());
}

/**
 * WAL-420: pre-insert duplicate lookup for accounts, matched by exact
 * case-insensitive name or domain. Returns the first match, or null when
 * neither field is usable or no match exists.
 */
export async function findDuplicateAccount(
  name?: string | null,
  domain?: string | null,
): Promise<Account | null> {
  const supabase = getServiceClient("findDuplicateAccount");
  if (!supabase) return null;

  const trimmedName = name?.trim();
  const trimmedDomain = domain?.trim();
  const conditions: string[] = [];
  if (trimmedName) conditions.push(`name.ilike.${ilikeExactValue(trimmedName)}`);
  if (trimmedDomain) conditions.push(`domain.ilike.${ilikeExactValue(trimmedDomain)}`);
  if (conditions.length === 0) return null;

  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .is("deleted_at", null)
    .or(conditions.join(","))
    .limit(1)
    .maybeSingle();

  if (error) {
    warn("findDuplicateAccount", error);
    return null;
  }
  return data ? accountFromRow(data as CrmRow) : null;
}

export async function createAccount(input: AccountInput): Promise<Account | null> {
  const supabase = getServiceClient("createAccount");
  if (!supabase) return null;

  const payload = pickAccountFields(input);

  const { data, error } = await supabase
    .from("accounts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    warn("createAccount", error);
    return null;
  }
  if (!data) return null;

  const account = accountFromRow(data as CrmRow);
  await audit(supabase, {
    action: "create",
    resource_type: "crm_account",
    resource_id: account.id,
    after: account,
  });
  return account;
}

export async function getAccount(id: string): Promise<Account | null> {
  const supabase = getServiceClient("getAccount");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    warn("getAccount", error);
    return null;
  }
  return data ? accountFromRow(data as CrmRow) : null;
}

export async function listAccounts(options?: KeysetListOptions): Promise<ListPage<Account>> {
  const supabase = getServiceClient("listAccounts");
  if (!supabase) return emptyPage();

  const limit = normalizeLimit(options?.limit);
  const search = normalizeSearch(options?.search);
  let query = supabase.from("accounts").select("*").is("deleted_at", null);

  if (search) query = query.ilike("name", ilikeContainsPattern(search));
  query = applyKeyset(query, options?.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;

  if (error) {
    warn("listAccounts", error);
    return emptyPage();
  }
  return pageFromRows((data ?? []) as CrmRow[], limit, accountFromRow);
}

export async function patchAccount(id: string, input: AccountInput): Promise<Account | null> {
  const supabase = getServiceClient("patchAccount");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const patch = pickAccountFields(input);

  const { data: beforeData, error: beforeError } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) warn("patchAccount:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("accounts")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("patchAccount", error);
    return null;
  }
  if (!data) return null;

  const account = accountFromRow(data as CrmRow);
  await audit(supabase, {
    action: "update",
    resource_type: "crm_account",
    resource_id: account.id,
    before: accountFromRow(beforeData as CrmRow),
    after: account,
  });
  return account;
}

export async function softDeleteAccount(id: string): Promise<Account | null> {
  const supabase = getServiceClient("softDeleteAccount");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const { data: beforeData, error: beforeError } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) warn("softDeleteAccount:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("accounts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("softDeleteAccount", error);
    return null;
  }
  if (!data) return null;

  const account = accountFromRow(data as CrmRow);
  await audit(supabase, {
    action: "soft_delete",
    resource_type: "crm_account",
    resource_id: account.id,
    before: accountFromRow(beforeData as CrmRow),
    after: account,
  });
  return account;
}

// --- cases ------------------------------------------------------------------

export async function listCases(options?: KeysetListOptions): Promise<ListPage<Case>> {
  const supabase = getServiceClient("listCases");
  if (!supabase) return emptyPage();

  const limit = normalizeLimit(options?.limit);
  const search = normalizeSearch(options?.search);
  let query = supabase.from("cases").select("*").is("deleted_at", null);

  // Staff look a case up by its number as often as by its title, so search
  // spans both rather than title alone.
  if (search) {
    const pattern = ilikeContainsPattern(search);
    query = query.or(`case_number.ilike.${pattern},title.ilike.${pattern}`);
  }
  query = applyKeyset(query, options?.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;

  if (error) {
    warn("listCases", error);
    return emptyPage();
  }
  return pageFromRows((data ?? []) as CrmRow[], limit, caseFromRow);
}

export async function getCase(id: string): Promise<Case | null> {
  const supabase = getServiceClient("getCase");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    warn("getCase", error);
    return null;
  }
  return data ? caseFromRow(data as CrmRow) : null;
}

export async function createCase(input: CaseInput): Promise<Case | null> {
  const supabase = getServiceClient("createCase");
  if (!supabase) return null;

  const payload = pickCaseFields(input);

  const { data, error } = await supabase
    .from("cases")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    warn("createCase", error);
    return null;
  }
  if (!data) return null;

  const record = caseFromRow(data as CrmRow);
  await audit(supabase, {
    action: "create",
    resource_type: "crm_case",
    resource_id: record.id,
    after: record,
  });
  return record;
}

export async function patchCase(id: string, input: CaseInput): Promise<Case | null> {
  const supabase = getServiceClient("patchCase");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const patch = pickCaseFields(input);
  if (Object.keys(patch).length === 0) return getCase(id);

  const { data: beforeData, error: beforeError } = await supabase
    .from("cases")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) warn("patchCase:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("cases")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("patchCase", error);
    return null;
  }
  if (!data) return null;

  const record = caseFromRow(data as CrmRow);
  await audit(supabase, {
    action: "update",
    resource_type: "crm_case",
    resource_id: record.id,
    before: caseFromRow(beforeData as CrmRow),
    after: record,
  });
  return record;
}

export async function softDeleteCase(id: string): Promise<Case | null> {
  const supabase = getServiceClient("softDeleteCase");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const { data: beforeData, error: beforeError } = await supabase
    .from("cases")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) warn("softDeleteCase:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("cases")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("softDeleteCase", error);
    return null;
  }
  if (!data) return null;

  const record = caseFromRow(data as CrmRow);
  await audit(supabase, {
    action: "soft_delete",
    resource_type: "crm_case",
    resource_id: record.id,
    before: caseFromRow(beforeData as CrmRow),
    after: record,
  });
  return record;
}

// --- contacts ---------------------------------------------------------------

/**
 * WAL-420: pre-insert duplicate lookup for contacts, matched by exact
 * case-insensitive email. Returns null when email is unusable or no match
 * exists.
 */
export async function findDuplicateContact(email?: string | null): Promise<Contact | null> {
  const supabase = getServiceClient("findDuplicateContact");
  if (!supabase) return null;

  const trimmedEmail = email?.trim();
  if (!trimmedEmail) return null;

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .is("deleted_at", null)
    .ilike("email", ilikeExactValue(trimmedEmail))
    .limit(1)
    .maybeSingle();

  if (error) {
    warn("findDuplicateContact", error);
    return null;
  }
  return data ? contactFromRow(data as CrmRow) : null;
}

export async function createContact(input: ContactInput): Promise<Contact | null> {
  const supabase = getServiceClient("createContact");
  if (!supabase) return null;

  const payload = pickContactFields(input);

  const { data, error } = await supabase
    .from("contacts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    warn("createContact", error);
    return null;
  }
  if (!data) return null;

  const contact = contactFromRow(data as CrmRow);
  await audit(supabase, {
    action: "create",
    resource_type: "crm_contact",
    resource_id: contact.id,
    after: contact,
  });
  return contact;
}

export async function getContact(id: string): Promise<Contact | null> {
  const supabase = getServiceClient("getContact");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    warn("getContact", error);
    return null;
  }
  return data ? contactFromRow(data as CrmRow) : null;
}

export async function listContacts(
  filter?: { accountId?: string } & KeysetListOptions,
): Promise<ListPage<Contact>> {
  const supabase = getServiceClient("listContacts");
  if (!supabase) return emptyPage();
  if (filter?.accountId && !isUuid(filter.accountId)) return emptyPage();

  const limit = normalizeLimit(filter?.limit);
  const search = normalizeSearch(filter?.search);
  let query = supabase.from("contacts").select("*").is("deleted_at", null);

  if (filter?.accountId) query = query.eq("account_id", filter.accountId);
  if (search) {
    const pattern = ilikeContainsPattern(sanitizeOrValue(search));
    query = query.or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`);
  }
  query = applyKeyset(query, filter?.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;

  if (error) {
    warn("listContacts", error);
    return emptyPage();
  }
  return pageFromRows((data ?? []) as CrmRow[], limit, contactFromRow);
}

export async function patchContact(id: string, input: ContactInput): Promise<Contact | null> {
  const supabase = getServiceClient("patchContact");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const patch = pickContactFields(input);

  const { data: beforeData, error: beforeError } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) warn("patchContact:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("patchContact", error);
    return null;
  }
  if (!data) return null;

  const contact = contactFromRow(data as CrmRow);
  await audit(supabase, {
    action: "update",
    resource_type: "crm_contact",
    resource_id: contact.id,
    before: contactFromRow(beforeData as CrmRow),
    after: contact,
  });
  return contact;
}

export async function softDeleteContact(id: string): Promise<Contact | null> {
  const supabase = getServiceClient("softDeleteContact");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const { data: beforeData, error: beforeError } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) warn("softDeleteContact:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("contacts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("softDeleteContact", error);
    return null;
  }
  if (!data) return null;

  const contact = contactFromRow(data as CrmRow);
  await audit(supabase, {
    action: "soft_delete",
    resource_type: "crm_contact",
    resource_id: contact.id,
    before: contactFromRow(beforeData as CrmRow),
    after: contact,
  });
  return contact;
}

// --- pipelines --------------------------------------------------------------

export async function listPipelines(): Promise<Pipeline[]> {
  const supabase = getServiceClient("listPipelines");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("crm_pipelines")
    .select("*")
    .order("order_index", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    warn("listPipelines", error);
    return [];
  }
  return ((data ?? []) as CrmRow[]).map(pipelineFromRow);
}

export async function createPipeline(input: PipelineInput): Promise<Pipeline | null> {
  const supabase = getServiceClient("createPipeline");
  if (!supabase) return null;

  const payload = pickPipelineFields(input);

  const { data, error } = await supabase
    .from("crm_pipelines")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    warn("createPipeline", error);
    return null;
  }
  if (!data) return null;

  const pipeline = pipelineFromRow(data as CrmRow);
  await audit(supabase, {
    action: "create",
    resource_type: "crm_pipeline",
    resource_id: pipeline.id,
    after: pipeline,
  });
  return pipeline;
}

export async function patchPipeline(id: string, input: PipelineInput): Promise<Pipeline | null> {
  const supabase = getServiceClient("patchPipeline");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const patch = pickPipelineFields(input);

  const { data: beforeData, error: beforeError } = await supabase
    .from("crm_pipelines")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) warn("patchPipeline:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("crm_pipelines")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("patchPipeline", error);
    return null;
  }
  if (!data) return null;

  const pipeline = pipelineFromRow(data as CrmRow);
  await audit(supabase, {
    action: "update",
    resource_type: "crm_pipeline",
    resource_id: pipeline.id,
    before: pipelineFromRow(beforeData as CrmRow),
    after: pipeline,
  });
  return pipeline;
}

// --- pipeline stages --------------------------------------------------------

export async function listActiveStages(filter?: { pipelineId?: string }): Promise<PipelineStage[]> {
  const supabase = getServiceClient("listActiveStages");
  if (!supabase) return [];
  if (filter?.pipelineId && !isUuid(filter.pipelineId)) return [];

  let query = supabase
    .from("crm_pipeline_stages")
    .select("*")
    .eq("active", true);
  if (filter?.pipelineId) query = query.eq("pipeline_id", filter.pipelineId);

  const { data, error } = await query
    .order("pipeline_id", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    warn("listActiveStages", error);
    return [];
  }
  return ((data ?? []) as CrmRow[]).map(stageFromRow);
}

export async function createStage(input: StageInput): Promise<PipelineStage | null> {
  const supabase = getServiceClient("createStage");
  if (!supabase) return null;
  if (input.pipeline_id != null && !isUuid(input.pipeline_id)) return null;

  const payload = pickStageFields(input);

  const { data, error } = await supabase
    .from("crm_pipeline_stages")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    warn("createStage", error);
    return null;
  }
  if (!data) return null;

  const stage = stageFromRow(data as CrmRow);
  await audit(supabase, {
    action: "create",
    resource_type: "crm_stage",
    resource_id: stage.id,
    after: stage,
  });
  return stage;
}

export async function patchStage(id: string, input: StageInput): Promise<PipelineStage | null> {
  const supabase = getServiceClient("patchStage");
  if (!supabase) return null;
  if (!isUuid(id)) return null;
  if (input.pipeline_id != null && !isUuid(input.pipeline_id)) return null;

  const patch = pickStageFields(input);

  const { data: beforeData, error: beforeError } = await supabase
    .from("crm_pipeline_stages")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) warn("patchStage:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("crm_pipeline_stages")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("patchStage", error);
    return null;
  }
  if (!data) return null;

  const stage = stageFromRow(data as CrmRow);
  await audit(supabase, {
    action: "update",
    resource_type: "crm_stage",
    resource_id: stage.id,
    before: stageFromRow(beforeData as CrmRow),
    after: stage,
  });
  return stage;
}

export async function reorderStages(orderedIds: string[]): Promise<PipelineStage[] | null> {
  const supabase = getServiceClient("reorderStages");
  if (!supabase) return null;
  if (orderedIds.length === 0) return null;
  if (new Set(orderedIds).size !== orderedIds.length) return null;
  if (!orderedIds.every(isUuid)) return null;

  const { data: beforeData, error: beforeError } = await supabase
    .from("crm_pipeline_stages")
    .select("*")
    .in("id", orderedIds);

  if (beforeError) {
    warn("reorderStages:before", beforeError);
    return null;
  }

  const beforeRows = (beforeData ?? []) as CrmRow[];
  if (beforeRows.length !== orderedIds.length) return null;

  const pipelineIds = new Set(beforeRows.map((row) => stringOrNull(row.pipeline_id)));
  if (pipelineIds.size !== 1 || pipelineIds.has(null)) return null;
  const pipelineId = [...pipelineIds][0];
  if (!pipelineId) return null;

  const beforeById = new Map(beforeRows.map((row) => [stringOrNull(row.id) ?? "", row]));

  const { error: reorderError } = await supabase.rpc("crm_reorder_pipeline_stages", {
    p_ids: orderedIds,
  });
  if (reorderError) {
    warn("reorderStages", reorderError);
    return null;
  }

  const { data: afterData, error: afterError } = await supabase
    .from("crm_pipeline_stages")
    .select("*")
    .in("id", orderedIds)
    .eq("pipeline_id", pipelineId)
    .order("sort_order", { ascending: true });

  if (afterError) {
    warn("reorderStages:after", afterError);
    return null;
  }

  const afterRows = (afterData ?? []) as CrmRow[];
  if (afterRows.length !== orderedIds.length) return null;

  const updated = afterRows.map(stageFromRow);
  for (const stage of updated) {
    await audit(supabase, {
      action: "update",
      resource_type: "crm_stage",
      resource_id: stage.id,
      before: stageFromRow(beforeById.get(stage.id) ?? {}),
      after: stage,
    });
  }

  return updated;
}

// --- opportunities ----------------------------------------------------------

export async function createOpportunity(input: OpportunityInput): Promise<Opportunity | null> {
  const supabase = getServiceClient("createOpportunity");
  if (!supabase) return null;

  const payload: CrmRow = {
    ...pickOpportunityFields(input),
    status: input.status ?? "open",
  };

  const { data, error } = await supabase
    .from("crm_opportunities")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    warn("createOpportunity", error);
    return null;
  }
  if (!data) return null;

  const opportunity = opportunityFromRow(data as CrmRow);
  if (opportunity.contact_id) {
    await ensurePrimaryDealContact(supabase, opportunity.id, opportunity.contact_id);
  }
  await audit(supabase, {
    action: "create",
    resource_type: "crm_opportunity",
    resource_id: opportunity.id,
    after: opportunity,
  });
  return opportunity;
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  const supabase = getServiceClient("getOpportunity");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const { data, error } = await supabase
    .from("crm_opportunities")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    warn("getOpportunity", error);
    return null;
  }
  return data ? opportunityFromRow(data as CrmRow) : null;
}

export async function listOpportunities(
  filter?: {
    stageId?: string;
    accountId?: string;
  } & KeysetListOptions,
): Promise<ListPage<Opportunity>> {
  const supabase = getServiceClient("listOpportunities");
  if (!supabase) return emptyPage();
  if (filter?.stageId && !isUuid(filter.stageId)) return emptyPage();
  if (filter?.accountId && !isUuid(filter.accountId)) return emptyPage();

  const limit = normalizeLimit(filter?.limit);
  const search = normalizeSearch(filter?.search);
  let query = supabase.from("crm_opportunities").select("*").is("deleted_at", null);

  if (filter?.stageId) query = query.eq("stage_id", filter.stageId);
  if (filter?.accountId) query = query.eq("account_id", filter.accountId);
  if (search) query = query.ilike("name", ilikeContainsPattern(search));
  query = applyKeyset(query, filter?.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;

  if (error) {
    warn("listOpportunities", error);
    return emptyPage();
  }
  return pageFromRows((data ?? []) as CrmRow[], limit, opportunityFromRow);
}

export async function patchOpportunity(
  id: string,
  input: OpportunityInput,
): Promise<Opportunity | null> {
  const supabase = getServiceClient("patchOpportunity");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const patch = pickOpportunityFields(input);

  const { data: beforeData, error: beforeError } = await supabase
    .from("crm_opportunities")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) warn("patchOpportunity:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("crm_opportunities")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("patchOpportunity", error);
    return null;
  }
  if (!data) return null;

  const opportunity = opportunityFromRow(data as CrmRow);
  if ("contact_id" in input) {
    if (opportunity.contact_id) {
      await ensurePrimaryDealContact(supabase, opportunity.id, opportunity.contact_id);
    } else {
      await clearPrimaryDealContacts(supabase, opportunity.id);
    }
  }
  await audit(supabase, {
    action: "update",
    resource_type: "crm_opportunity",
    resource_id: opportunity.id,
    before: opportunityFromRow(beforeData as CrmRow),
    after: opportunity,
  });
  return opportunity;
}

export async function softDeleteOpportunity(id: string): Promise<Opportunity | null> {
  const supabase = getServiceClient("softDeleteOpportunity");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const { data: beforeData, error: beforeError } = await supabase
    .from("crm_opportunities")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) warn("softDeleteOpportunity:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("crm_opportunities")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("softDeleteOpportunity", error);
    return null;
  }
  if (!data) return null;

  const opportunity = opportunityFromRow(data as CrmRow);
  await audit(supabase, {
    action: "soft_delete",
    resource_type: "crm_opportunity",
    resource_id: opportunity.id,
    before: opportunityFromRow(beforeData as CrmRow),
    after: opportunity,
  });
  return opportunity;
}

// --- deal contacts ----------------------------------------------------------

export async function listDealContacts(dealId: string): Promise<DealContact[]> {
  const supabase = getServiceClient("listDealContacts");
  if (!supabase) return [];
  if (!isUuid(dealId)) return [];

  const { data, error } = await supabase
    .from("crm_deal_contacts")
    .select("*")
    .eq("deal_id", dealId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    warn("listDealContacts", error);
    return [];
  }
  return ((data ?? []) as CrmRow[]).map(dealContactFromRow);
}

export async function addDealContact(input: DealContactInput): Promise<DealContact | null> {
  const supabase = getServiceClient("addDealContact");
  if (!supabase) return null;
  if (!isUuid(input.deal_id) || !isUuid(input.contact_id)) return null;

  const { data: dealData, error: dealError } = await supabase
    .from("crm_opportunities")
    .select("id")
    .eq("id", input.deal_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (dealError) {
    warn("addDealContact:deal", dealError);
    return null;
  }
  if (!dealData) return null;

  const { data: beforeData, error: beforeError } = await supabase
    .from("crm_deal_contacts")
    .select("*")
    .eq("deal_id", input.deal_id)
    .eq("contact_id", input.contact_id)
    .maybeSingle();
  if (beforeError) warn("addDealContact:before", beforeError);

  if (input.is_primary === true) {
    const ok = await ensurePrimaryDealContact(
      supabase,
      input.deal_id,
      input.contact_id,
      input.role,
    );
    if (!ok) return null;

    const { data, error } = await supabase
      .from("crm_deal_contacts")
      .select("*")
      .eq("deal_id", input.deal_id)
      .eq("contact_id", input.contact_id)
      .maybeSingle();

    if (error) {
      warn("addDealContact:primary:after", error);
      return null;
    }
    if (!data) return null;

    const dealContact = dealContactFromRow(data as CrmRow);
    await audit(supabase, {
      action: beforeData ? "update" : "create",
      resource_type: "crm_deal_contact",
      resource_id: `${dealContact.deal_id}:${dealContact.contact_id}`,
      before: beforeData ? dealContactFromRow(beforeData as CrmRow) : null,
      after: dealContact,
    });
    return dealContact;
  }

  const payload: CrmRow = {
    deal_id: input.deal_id,
    contact_id: input.contact_id,
    ...pickDealContactFields(input),
  };

  const { data, error } = await supabase
    .from("crm_deal_contacts")
    .upsert(payload, { onConflict: "deal_id,contact_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    warn("addDealContact", error);
    return null;
  }
  if (!data) return null;

  const dealContact = dealContactFromRow(data as CrmRow);
  if (dealContact.is_primary) {
    await setLegacyPrimaryContact(supabase, dealContact.deal_id, dealContact.contact_id);
  } else if (
    "is_primary" in input &&
    input.is_primary === false &&
    beforeData &&
    dealContactFromRow(beforeData as CrmRow).is_primary
  ) {
    await clearLegacyPrimaryContactIfMatches(
      supabase,
      dealContact.deal_id,
      dealContact.contact_id,
    );
  }

  await audit(supabase, {
    action: beforeData ? "update" : "create",
    resource_type: "crm_deal_contact",
    resource_id: `${dealContact.deal_id}:${dealContact.contact_id}`,
    before: beforeData ? dealContactFromRow(beforeData as CrmRow) : null,
    after: dealContact,
  });
  return dealContact;
}

export async function removeDealContact(
  dealId: string,
  contactId: string,
): Promise<DealContact | null> {
  const supabase = getServiceClient("removeDealContact");
  if (!supabase) return null;
  if (!isUuid(dealId) || !isUuid(contactId)) return null;

  const { data: beforeData, error: beforeError } = await supabase
    .from("crm_deal_contacts")
    .select("*")
    .eq("deal_id", dealId)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (beforeError) {
    warn("removeDealContact:before", beforeError);
    return null;
  }
  if (!beforeData) return null;

  const before = dealContactFromRow(beforeData as CrmRow);
  const { error } = await supabase
    .from("crm_deal_contacts")
    .delete()
    .eq("deal_id", dealId)
    .eq("contact_id", contactId);

  if (error) {
    warn("removeDealContact", error);
    return null;
  }

  if (before.is_primary) {
    await clearLegacyPrimaryContactIfMatches(supabase, dealId, contactId);
  }

  await audit(supabase, {
    action: "delete",
    resource_type: "crm_deal_contact",
    resource_id: `${dealId}:${contactId}`,
    before,
    after: null,
  });
  return before;
}

// --- activities -------------------------------------------------------------

export async function listActivities(filter: {
  opportunityId?: string;
  contactId?: string;
}): Promise<Activity[]> {
  const supabase = getServiceClient("listActivities");
  if (!supabase) return [];
  if (filter.opportunityId !== undefined && !isUuid(filter.opportunityId)) return [];
  if (filter.contactId !== undefined && !isUuid(filter.contactId)) return [];

  let query = supabase.from("crm_activities").select("*");
  if (filter.opportunityId) query = query.eq("opportunity_id", filter.opportunityId);
  if (filter.contactId) query = query.eq("contact_id", filter.contactId);
  query = query.order("occurred_at", { ascending: false }).limit(MAX_LIST_LIMIT);

  const { data, error } = await query;

  if (error) {
    warn("listActivities", error);
    return [];
  }
  return ((data ?? []) as CrmRow[]).map(activityFromRow);
}

export async function createActivity(input: ActivityInput): Promise<Activity | null> {
  const supabase = getServiceClient("createActivity");
  if (!supabase) return null;

  const payload: CrmRow = {
    opportunity_id: input.opportunity_id ?? null,
    contact_id: input.contact_id ?? null,
    account_id: input.account_id ?? null,
    type: ACTIVITY_TYPES.includes(input.type) ? input.type : "note",
    body: input.body ?? null,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("crm_activities")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    warn("createActivity", error);
    return null;
  }
  if (!data) return null;

  const activity = activityFromRow(data as CrmRow);
  await audit(supabase, {
    action: "create",
    resource_type: "crm_activity",
    resource_id: activity.id,
    after: activity,
  });
  return activity;
}

// --- tasks ------------------------------------------------------------------

export async function listTasks(filter?: {
  opportunityId?: string;
  contactId?: string;
}): Promise<CrmTask[]> {
  const supabase = getServiceClient("listTasks");
  if (!supabase) return [];
  if (filter?.opportunityId !== undefined && !isUuid(filter.opportunityId)) return [];
  if (filter?.contactId !== undefined && !isUuid(filter.contactId)) return [];

  let query = supabase.from("crm_tasks").select("*");
  if (filter?.opportunityId) query = query.eq("opportunity_id", filter.opportunityId);
  if (filter?.contactId) query = query.eq("contact_id", filter.contactId);
  query = query.order("due_date", { ascending: true }).limit(MAX_LIST_LIMIT);

  const { data, error } = await query;

  if (error) {
    warn("listTasks", error);
    return [];
  }
  return ((data ?? []) as CrmRow[]).map(taskFromRow);
}

export async function listAllTasks(filter: {
  due: "overdue" | "today" | "upcoming" | "all";
  limit?: number | null;
  cursor?: string | null;
  today?: string;
}): Promise<ListPage<CrmTask>> {
  const supabase = getServiceClient("listAllTasks");
  if (!supabase) return emptyPage();

  const limit = normalizeLimit(filter.limit);
  const today =
    typeof filter.today === "string" && ISO_DATE_RE.test(filter.today)
      ? filter.today
      : taskToday();
  let query = supabase.from("crm_tasks").select("*").eq("done", false);

  if (filter.due === "overdue") query = query.lt("due_date", today);
  if (filter.due === "today") query = query.eq("due_date", today);
  if (filter.due === "upcoming") query = query.gt("due_date", today);

  query = applyKeyset(query, filter.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;

  if (error) {
    warn("listAllTasks", error);
    return emptyPage();
  }
  return pageFromRows((data ?? []) as CrmRow[], limit, taskFromRow);
}

export async function createTask(input: CrmTaskInput): Promise<CrmTask | null> {
  const supabase = getServiceClient("createTask");
  if (!supabase) return null;

  const payload = pickTaskFields(input);

  const { data, error } = await supabase
    .from("crm_tasks")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    warn("createTask", error);
    return null;
  }
  if (!data) return null;

  const task = taskFromRow(data as CrmRow);
  await audit(supabase, {
    action: "create",
    resource_type: "crm_task",
    resource_id: task.id,
    after: task,
  });
  return task;
}

export async function patchTask(id: string, input: CrmTaskInput): Promise<CrmTask | null> {
  const supabase = getServiceClient("patchTask");
  if (!supabase) return null;
  if (!isUuid(id)) return null;

  const patch = pickTaskFields(input);

  const { data: beforeData, error: beforeError } = await supabase
    .from("crm_tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) warn("patchTask:before", beforeError);
  if (!beforeData) return null;

  const { data, error } = await supabase
    .from("crm_tasks")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("patchTask", error);
    return null;
  }
  if (!data) return null;

  const task = taskFromRow(data as CrmRow);
  await audit(supabase, {
    action: "update",
    resource_type: "crm_task",
    resource_id: task.id,
    before: taskFromRow(beforeData as CrmRow),
    after: task,
  });
  return task;
}

// Re-export caps so routes.ts can enforce them without re-declaring.
export { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, MAX_NAME, MAX_TEXT };
