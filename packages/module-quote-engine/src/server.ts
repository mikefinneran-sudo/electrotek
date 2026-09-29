// Service-role data access for the quote engine. inspections and quote_addons
// are staff/service-role managed (no anon/authenticated RLS policies), so all
// reads and writes here use the service-role key, which bypasses RLS. Guard
// every call with isQuoteEngineConfigured() and degrade gracefully when env is
// missing — mirrors the catalog module's isCatalogConfigured posture.

import "server-only";
import {
  attributePatchFromInput,
  attributeValue,
  attributesRecord,
  hasAttributePatch,
  isMissingAttributesColumnError,
  mergeAttributes,
} from "@waltersignal/bananaforce-core";
import { fetchAllRows } from "@waltersignal/bananaforce-data-supabase/pagination";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import { isQuoteActionable } from "./lifecycle";
import {
  buildGeneratedLines,
  isEmptyLinePlan,
  planGeneratedLines,
  planManualLines,
  type LineWritePlan,
  type ManualLineInput,
  type QuoteLineItem,
  type QuoteLineItemInput,
} from "./line-items";
import { DEFAULT_PRICING } from "./pricing";
import type {
  Inspection,
  InspectionStatus,
  PricingConfig,
  QuoteAddon,
  TaskLibraryRow,
} from "./types";
import { INSPECTION_STATUSES } from "./types";

type QuoteRow = Record<string, unknown>;

export interface InspectionInput {
  prospect_name?: string | null;
  prospect_company?: string | null;
  prospect_email?: string | null;
  prospect_phone?: string | null;
  office_address?: string | null;
  walkthrough_date?: string | null;
  cleanable_sqft?: number | null;
  visits_per_week?: number | null;
  scope_inclusions?: string | null;
  scope_exclusions?: string | null;
  cleaning_days?: string | null;
  clean_window?: string | null;
  target_start?: string | null;
  consumables_provided_by?: string | null;
  current_cleaner?: string | null;
  current_cleaner_issues?: string | null;
  decision_process?: string | null;
  internal_notes?: string | null;
  number_of_offices?: number | null;
  number_of_board_rooms?: number | null;
  dumpster_access?: string | null;
  parking_access?: string | null;
  water_access?: string | null;
  status?: InspectionStatus;
  /**
   * Explicit expiry date. Omit to let the DB stamp `current_date + 30` on the
   * transition into 'sent' (quote_engine_guard_status). Supplying it here wins.
   */
  valid_until?: string | null;
  quote_rate_per_sqft?: number | null;
  quote_base_monthly?: number | null;
  attributes?: Record<string, unknown>;
}

export interface AddonInput {
  addon_id: string;
  name: string;
  price?: number | null;
  enabled?: boolean;
}

const WRITABLE_FIELDS: readonly (keyof InspectionInput)[] = [
  "prospect_name",
  "prospect_company",
  "prospect_email",
  "prospect_phone",
  "office_address",
  "walkthrough_date",
  "cleanable_sqft",
  "visits_per_week",
  "scope_inclusions",
  "scope_exclusions",
  "cleaning_days",
  "clean_window",
  "target_start",
  "consumables_provided_by",
  "current_cleaner",
  "current_cleaner_issues",
  "decision_process",
  "internal_notes",
  "number_of_offices",
  "number_of_board_rooms",
  "dumpster_access",
  "parking_access",
  "water_access",
  "status",
  "valid_until",
  "quote_rate_per_sqft",
  "quote_base_monthly",
];

// estimate_number and public_token are deliberately NOT writable: the first is
// immutable identity assigned by the sequence, the second is a credential.
// The lifecycle timestamps are stamped by quote_engine_guard_status().

const MODULE_LABEL = "Quote engine";

const INSPECTION_ATTRIBUTE_FIELDS = [
  "cleanable_sqft",
  "visits_per_week",
  "cleaning_days",
  "clean_window",
  "consumables_provided_by",
  "current_cleaner",
  "current_cleaner_issues",
] as const;

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

function statusOrDraft(value: unknown): InspectionStatus {
  return INSPECTION_STATUSES.includes(value as InspectionStatus)
    ? (value as InspectionStatus)
    : "drafting";
}

/**
 * Env-only check (no I/O), safe to import from anywhere. The service-role key is
 * required for staff-managed reads/writes; without it, the module degrades to
 * setup-required empties rather than throwing.
 */
export function isQuoteEngineConfigured(): boolean {
  return isServiceRoleConfigured();
}

// The service-role client is shared from data-supabase — the single module that
// holds the service-role key (and is `server-only`). null when env is missing,
// so callers degrade to setup-required empties rather than throwing.
const getServiceClient = (operation: string) =>
  getServiceClientOrNull(MODULE_LABEL, operation);

function inspectionFromRow(row: QuoteRow): Inspection {
  return {
    id: stringOrNull(row.id) ?? "",
    inspection_slug: stringOrNull(row.inspection_slug) ?? "",
    prospect_name: stringOrNull(row.prospect_name),
    prospect_company: stringOrNull(row.prospect_company),
    prospect_email: stringOrNull(row.prospect_email),
    prospect_phone: stringOrNull(row.prospect_phone),
    office_address: stringOrNull(row.office_address),
    walkthrough_date: stringOrNull(row.walkthrough_date),
    attributes: attributesRecord(row.attributes),
    cleanable_sqft: numberOrNull(attributeValue(row, "cleanable_sqft")),
    visits_per_week: numberOrNull(attributeValue(row, "visits_per_week")),
    scope_inclusions: stringOrNull(row.scope_inclusions),
    scope_exclusions: stringOrNull(row.scope_exclusions),
    cleaning_days: stringOrNull(attributeValue(row, "cleaning_days")),
    clean_window: stringOrNull(attributeValue(row, "clean_window")),
    target_start: stringOrNull(row.target_start),
    consumables_provided_by: stringOrNull(attributeValue(row, "consumables_provided_by")),
    current_cleaner: stringOrNull(attributeValue(row, "current_cleaner")),
    current_cleaner_issues: stringOrNull(attributeValue(row, "current_cleaner_issues")),
    decision_process: stringOrNull(row.decision_process),
    internal_notes: stringOrNull(row.internal_notes),
    number_of_offices: numberOrNull(row.number_of_offices),
    number_of_board_rooms: numberOrNull(row.number_of_board_rooms),
    dumpster_access: stringOrNull(row.dumpster_access),
    parking_access: stringOrNull(row.parking_access),
    water_access: stringOrNull(row.water_access),
    status: statusOrDraft(row.status),
    estimate_number: stringOrNull(row.estimate_number) ?? "",
    valid_until: stringOrNull(row.valid_until),
    public_token: stringOrNull(row.public_token),
    sent_at: stringOrNull(row.sent_at),
    viewed_at: stringOrNull(row.viewed_at),
    accepted_at: stringOrNull(row.accepted_at),
    declined_at: stringOrNull(row.declined_at),
    quote_rate_per_sqft: numberOrNull(row.quote_rate_per_sqft),
    quote_base_monthly: numberOrNull(row.quote_base_monthly),
    // Trigger-maintained, and defaulted rather than nullable so a pre-0006 row
    // (or a select that predates the columns) reads as an unpriced quote instead
    // of poisoning arithmetic downstream with null.
    currency: stringOrNull(row.currency) ?? "usd",
    subtotal: numberOrNull(row.subtotal) ?? 0,
    tax: numberOrNull(row.tax) ?? 0,
    total: numberOrNull(row.total) ?? 0,
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function addonFromRow(row: QuoteRow): QuoteAddon {
  return {
    id: numberOrNull(row.id) ?? undefined,
    inspection_id: stringOrNull(row.inspection_id) ?? undefined,
    addon_id: stringOrNull(row.addon_id) ?? "",
    name: stringOrNull(row.name) ?? "",
    price: numberOrNull(row.price),
    enabled: row.enabled !== false,
  };
}

function taskLibraryFromRow(row: QuoteRow): TaskLibraryRow {
  return {
    id: numberOrNull(row.id) ?? 0,
    task_name: stringOrNull(row.task_name) ?? "",
    default_frequency: stringOrNull(row.default_frequency),
    area: stringOrNull(row.area),
    match_keywords: stringOrNull(row.match_keywords),
    sort_order: numberOrNull(row.sort_order) ?? 0,
    always_include: row.always_include === true,
    active: row.active !== false,
  };
}

/** Random URL-safe slug for a new inspection. Uses a UUID for collision-free
 * uniqueness (the column is `unique`); Math.random would collide at volume. */
function generateSlug(): string {
  return `insp-${crypto.randomUUID().slice(0, 8)}`;
}

function pickWritableFields(input: InspectionInput): QuoteRow {
  const patch: QuoteRow = {};
  for (const field of WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

function inspectionAttributesFromInput(input: InspectionInput): QuoteRow | null {
  const attributePatch = {
    ...attributesRecord(input.attributes),
    ...attributePatchFromInput(input as Record<string, unknown>, INSPECTION_ATTRIBUTE_FIELDS),
  };
  return hasAttributePatch(attributePatch) ? attributePatch : null;
}

async function inspectionAttributesPatch(
  supabase: NonNullable<ReturnType<typeof getServiceClient>>,
  id: string,
  input: InspectionInput,
): Promise<QuoteRow | null> {
  const attributePatch = inspectionAttributesFromInput(input);
  if (!attributePatch) return null;

  const { data, error } = await supabase
    .from("inspections")
    .select("attributes")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // Pre-migration: degrade to a legacy-only write.
    if (isMissingAttributesColumnError(error)) return null;
    // Real pre-fetch failure: abort rather than writing only legacy and leaving
    // `attributes` stale (the attribute-preferring read would then serve old data).
    throw error;
  }

  return mergeAttributes((data as QuoteRow | null)?.attributes, attributePatch);
}

// --- inspections ---------------------------------------------------------

export async function createInspection(input: InspectionInput): Promise<Inspection | null> {
  const supabase = getServiceClient("createInspection");
  if (!supabase) return null;

  const payload: QuoteRow = {
    ...pickWritableFields(input),
    inspection_slug: generateSlug(),
    status: input.status ?? "drafting",
  };
  const attributes = inspectionAttributesFromInput(input);
  if (attributes) payload.attributes = attributes;

  let { data, error } = await supabase
    .from("inspections")
    .insert(payload)
    .select("*")
    .single();

  if (error && payload.attributes && isMissingAttributesColumnError(error)) {
    const { attributes: _attributes, ...legacyPayload } = payload;
    const retry = await supabase
      .from("inspections")
      .insert(legacyPayload)
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    warn("createInspection", error);
    return null;
  }
  return data ? inspectionFromRow(data as QuoteRow) : null;
}

export async function getInspection(id: string): Promise<Inspection | null> {
  const supabase = getServiceClient("getInspection");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("inspections")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    warn("getInspection", error);
    return null;
  }
  return data ? inspectionFromRow(data as QuoteRow) : null;
}

export async function listInspections(): Promise<Inspection[]> {
  const supabase = getServiceClient("listInspections");
  if (!supabase) return [];

  const { data, error } = await fetchAllRows<QuoteRow>((from, to) =>
    supabase
      .from("inspections")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to),
  );

  if (error) {
    warn("listInspections", error);
    return [];
  }
  return data.map(inspectionFromRow);
}

export async function patchInspection(
  id: string,
  input: InspectionInput,
): Promise<Inspection | null> {
  const supabase = getServiceClient("patchInspection");
  if (!supabase) return null;

  const patch = pickWritableFields(input);
  let attributes: ReturnType<typeof mergeAttributes> | null;
  try {
    attributes = await inspectionAttributesPatch(supabase, id, input);
  } catch (error) {
    // Never do a partial (legacy-only) write when the attributes side errored.
    warn("patchInspection:attributes", error);
    return null;
  }
  if (attributes) patch.attributes = attributes;
  // sent_at / viewed_at / accepted_at / declined_at and the valid_until window
  // are stamped by the quote_engine_guard_status trigger, which also rejects
  // illegal transitions. Do NOT stamp them here: the trigger fires for the
  // service-role client too, so it is the one chokepoint every writer shares.

  let { data, error } = await supabase
    .from("inspections")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error && patch.attributes && isMissingAttributesColumnError(error)) {
    const { attributes: _attributes, ...legacyPatch } = patch;
    const retry = await supabase
      .from("inspections")
      .update(legacyPatch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    warn("patchInspection", error);
    return null;
  }
  return data ? inspectionFromRow(data as QuoteRow) : null;
}

// --- customer-facing access (token-gated) --------------------------------
//
// Same posture as module-client-portal and module-contract-esign: the customer
// never gets a DB grant. The route verifies the token, then everything below
// runs through the service-role client. anon has no policy on `inspections`.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject malformed tokens before they reach Postgres (a non-uuid string is a
 * 22P02 error, not a miss, and would be logged as a failure rather than a 404). */
function isTokenShaped(token: unknown): token is string {
  return typeof token === "string" && UUID_RE.test(token);
}

/**
 * Look up an inspection by its customer token. Returns null for both "no such
 * token" and "malformed token" so the route cannot distinguish them in a reply
 * — a valid-but-unknown token and a garbage token must look identical.
 */
export async function getInspectionByToken(token: string): Promise<Inspection | null> {
  if (!isTokenShaped(token)) return null;

  const supabase = getServiceClient("getInspectionByToken");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("inspections")
    .select("*")
    .eq("public_token", token)
    .maybeSingle();

  if (error) {
    warn("getInspectionByToken", error);
    return null;
  }
  return data ? inspectionFromRow(data as QuoteRow) : null;
}

/**
 * Stamp first-open. Best effort: a failure here must never block rendering the
 * quote, so the caller ignores the result. Scoped to status='sent' so a reopen
 * does not churn the row and viewed_at keeps the FIRST open, not the latest.
 */
export async function recordQuoteViewed(token: string): Promise<void> {
  if (!isTokenShaped(token)) return;

  const supabase = getServiceClient("recordQuoteViewed");
  if (!supabase) return;

  const { error } = await supabase
    .from("inspections")
    .update({ status: "viewed" })
    .eq("public_token", token)
    .eq("status", "sent");

  if (error) warn("recordQuoteViewed", error);
}

export type QuoteResponse = "accepted" | "declined";

export type QuoteResponseResult =
  | { ok: true; inspection: Inspection }
  | { ok: false; reason: "not_found" | "expired" | "already_responded" | "error" };

/**
 * Record the customer's accept/decline.
 *
 * Expiry is re-checked HERE rather than trusted from the rendered page: the
 * page may have been open in a tab across the expiry boundary, and
 * quote_engine_expire_stale() is unscheduled so the stored status can still say
 * 'sent' past valid_until. The date decides, not the stored status.
 *
 * The update is scoped to status in (sent, viewed), so a concurrent second
 * response affects zero rows and reports already_responded instead of silently
 * overwriting the first one.
 */
export async function respondToQuote(
  token: string,
  response: QuoteResponse,
): Promise<QuoteResponseResult> {
  if (!isTokenShaped(token)) return { ok: false, reason: "not_found" };

  const supabase = getServiceClient("respondToQuote");
  if (!supabase) return { ok: false, reason: "error" };

  const current = await getInspectionByToken(token);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status === "accepted" || current.status === "declined") {
    return { ok: false, reason: "already_responded" };
  }
  if (!isQuoteActionable(current)) return { ok: false, reason: "expired" };

  const { data, error } = await supabase
    .from("inspections")
    .update({ status: response })
    .eq("public_token", token)
    .in("status", ["sent", "viewed"])
    .select("*")
    .maybeSingle();

  if (error) {
    warn("respondToQuote", error);
    return { ok: false, reason: "error" };
  }
  if (!data) return { ok: false, reason: "already_responded" };
  return { ok: true, inspection: inspectionFromRow(data as QuoteRow) };
}

// --- quote add-ons -------------------------------------------------------

export async function getAddons(inspectionId: string): Promise<QuoteAddon[]> {
  const supabase = getServiceClient("getAddons");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("quote_addons")
    .select("*")
    .eq("inspection_id", inspectionId)
    .order("id", { ascending: true });

  if (error) {
    warn("getAddons", error);
    return [];
  }
  return ((data ?? []) as QuoteRow[]).map(addonFromRow);
}

/**
 * Upsert add-on rows for an inspection. Conflicts on (inspection_id, addon_id)
 * so re-saving the same add-on updates price/enabled instead of duplicating.
 */
export async function upsertAddons(
  inspectionId: string,
  addons: readonly AddonInput[],
): Promise<QuoteAddon[]> {
  const supabase = getServiceClient("upsertAddons");
  if (!supabase) return [];

  const rows = addons.map((a) => ({
    inspection_id: inspectionId,
    addon_id: a.addon_id,
    name: a.name,
    price: numberOrNull(a.price),
    enabled: a.enabled !== false,
  }));

  if (rows.length === 0) return getAddons(inspectionId);

  const { data, error } = await supabase
    .from("quote_addons")
    .upsert(rows, { onConflict: "inspection_id,addon_id" })
    .select("*");

  if (error) {
    warn("upsertAddons", error);
    return [];
  }
  return ((data ?? []) as QuoteRow[]).map(addonFromRow);
}

export async function deleteAddon(inspectionId: string, addonId: string): Promise<boolean> {
  const supabase = getServiceClient("deleteAddon");
  if (!supabase) return false;

  const { error } = await supabase
    .from("quote_addons")
    .delete()
    .eq("inspection_id", inspectionId)
    .eq("addon_id", addonId);

  if (error) {
    warn("deleteAddon", error);
    return false;
  }
  return true;
}

// --- quote line items ----------------------------------------------------
//
// The merged pricing model (docs/QUOTE-MODULE-MERGE.md). Two invariants run
// through everything below:
//
//   1. `line_total` is a GENERATED column and `inspections.subtotal/tax/total`
//      are owned by the quote_engine_recompute_totals() trigger. Neither is ever
//      in a payload from here. `lineRowFromInput` is the guard: it names every
//      column it writes, so a caller cannot smuggle one in.
//   2. origin='manual' lines belong to the operator. `regenerateQuoteLines`
//      cannot touch them and a manual save cannot touch generated lines. The
//      split is enforced in the pure planners (see ./line-items).

function lineItemFromRow(row: QuoteRow): QuoteLineItem {
  return {
    id: stringOrNull(row.id) ?? undefined,
    inspection_id: stringOrNull(row.inspection_id) ?? undefined,
    product_id: numberOrNull(row.product_id),
    sku: stringOrNull(row.sku),
    description: stringOrNull(row.description) ?? "",
    quantity: numberOrNull(row.quantity) ?? 0,
    unit_price: numberOrNull(row.unit_price) ?? 0,
    line_total: numberOrNull(row.line_total) ?? undefined,
    tax_rate: numberOrNull(row.tax_rate) ?? 0,
    origin: row.origin === "generated" ? "generated" : "manual",
    origin_key: stringOrNull(row.origin_key),
    sort_order: numberOrNull(row.sort_order) ?? 0,
  };
}

/**
 * The write payload for one line. An explicit column list, not a spread of the
 * input: `line_total` is generated and Postgres rejects a write to it (42501),
 * so a caller passing a whole read-back row through must not be able to turn a
 * save into an error.
 */
function lineRowFromInput(inspectionId: string, line: QuoteLineItemInput): QuoteRow {
  return {
    inspection_id: inspectionId,
    product_id: line.product_id ?? null,
    sku: line.sku ?? null,
    description: line.description,
    quantity: numberOrNull(line.quantity) ?? 0,
    unit_price: numberOrNull(line.unit_price) ?? 0,
    tax_rate: numberOrNull(line.tax_rate) ?? 0,
    origin: line.origin,
    origin_key: line.origin_key ?? null,
    sort_order: numberOrNull(line.sort_order) ?? 0,
  };
}

/**
 * Lines on a quote, in document order.
 *
 * Ordered by (sort_order, created_at) rather than sort_order alone: two lines
 * can legitimately share a sort_order (a manual row added while a regenerate was
 * in flight), and an unstable order would make the PDF and the customer page
 * disagree between renders of the same quote.
 */
export async function listLineItems(inspectionId: string): Promise<QuoteLineItem[]> {
  const supabase = getServiceClient("listLineItems");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("quote_line_items")
    .select("*")
    .eq("inspection_id", inspectionId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    warn("listLineItems", error);
    return [];
  }
  return ((data ?? []) as QuoteRow[]).map(lineItemFromRow);
}

/**
 * Execute a write plan.
 *
 * Order matters: deletes run LAST. A plan that inserts a replacement and drops a
 * stale row must not leave the quote briefly missing both if the insert fails —
 * and since the trigger recomputes totals on every row, an aborted plan leaves
 * the totals consistent with whatever rows actually exist.
 *
 * Updates are scoped by `inspection_id` as well as `id`. The planners already
 * refuse to target a row they did not read, but the write is where it costs
 * nothing to also make a cross-quote id useless.
 *
 * Returns false on the first failure rather than pressing on: a half-applied
 * price change is worse than a refused one, because the quote still renders.
 */
async function applyLinePlan(
  inspectionId: string,
  plan: LineWritePlan,
  operation: string,
): Promise<boolean> {
  if (isEmptyLinePlan(plan)) return true;

  const supabase = getServiceClient(operation);
  if (!supabase) return false;

  if (plan.insert.length) {
    const { error } = await supabase
      .from("quote_line_items")
      .insert(plan.insert.map((line) => lineRowFromInput(inspectionId, line)));
    if (error) {
      warn(`${operation}:insert`, error);
      return false;
    }
  }

  for (const { id, patch } of plan.update) {
    const { inspection_id: _scope, ...columns } = lineRowFromInput(inspectionId, patch);
    const { error } = await supabase
      .from("quote_line_items")
      .update(columns)
      .eq("id", id)
      .eq("inspection_id", inspectionId);
    if (error) {
      warn(`${operation}:update`, error);
      return false;
    }
  }

  if (plan.deleteIds.length) {
    const { error } = await supabase
      .from("quote_line_items")
      .delete()
      .in("id", plan.deleteIds)
      .eq("inspection_id", inspectionId);
    if (error) {
      warn(`${operation}:delete`, error);
      return false;
    }
  }

  return true;
}

/**
 * Regenerate the walkthrough-derived lines for a quote.
 *
 * This is the call that makes the sqft × rate × visits calculation a line
 * GENERATOR rather than a second pricing path: after it runs, the lines sum to
 * the quote's total and there is no other place the money can come from.
 *
 * Idempotent. Running it twice in a row produces the same rows — matched by
 * origin_key and updated in place, so a line keeps its identity (and its sort
 * position) across regenerations. Manual lines are untouched.
 */
export async function regenerateQuoteLines(
  inspectionId: string,
  options?: { pricing?: PricingConfig; taxRate?: number },
): Promise<QuoteLineItem[]> {
  const inspection = await getInspection(inspectionId);
  if (!inspection) return [];

  const [addons, existing] = await Promise.all([
    getAddons(inspectionId),
    listLineItems(inspectionId),
  ]);

  const generated = buildGeneratedLines(
    inspection,
    addons,
    options?.pricing ?? DEFAULT_PRICING,
    options?.taxRate ?? 0,
  );

  const ok = await applyLinePlan(
    inspectionId,
    planGeneratedLines(existing, generated),
    "regenerateQuoteLines",
  );
  // Re-read either way. On failure the caller still needs the truth about what
  // is stored, not the set we hoped to write.
  const lines = await listLineItems(inspectionId);
  if (!ok) warn("regenerateQuoteLines", new Error("line plan did not fully apply"));
  return lines;
}

/**
 * Replace the operator's manual lines with `lines`.
 *
 * FULL-SET semantics, scoped to manual: a manual line the caller no longer lists
 * is deleted, which is what a line editor's delete button has to mean. Generated
 * lines are never in scope, so however the editor posts, it cannot remove the
 * base service line.
 *
 * The caller must only invoke this when it genuinely holds the whole manual set.
 * A PATCH that simply does not mention line items must not reach here — it would
 * read as "the operator deleted every hand-written row".
 */
export async function upsertLineItems(
  inspectionId: string,
  lines: readonly ManualLineInput[],
): Promise<QuoteLineItem[]> {
  const existing = await listLineItems(inspectionId);
  const ok = await applyLinePlan(
    inspectionId,
    planManualLines(existing, lines),
    "upsertLineItems",
  );
  const current = await listLineItems(inspectionId);
  if (!ok) warn("upsertLineItems", new Error("line plan did not fully apply"));
  return current;
}

/**
 * Delete one line.
 *
 * Scoped to (id, inspection_id) so a line id from another quote is a no-op
 * rather than a cross-quote delete, and refuses generated lines: those are
 * derived state, and deleting one by hand would only have it reappear on the
 * next regenerate. Turn off the add-on, or change the walkthrough, instead.
 */
export async function deleteLineItem(inspectionId: string, lineId: string): Promise<boolean> {
  const supabase = getServiceClient("deleteLineItem");
  if (!supabase) return false;

  const { error, count } = await supabase
    .from("quote_line_items")
    .delete({ count: "exact" })
    .eq("id", lineId)
    .eq("inspection_id", inspectionId)
    .eq("origin", "manual");

  if (error) {
    warn("deleteLineItem", error);
    return false;
  }
  return (count ?? 0) > 0;
}

// --- task library --------------------------------------------------------

export async function getTaskLibrary(): Promise<TaskLibraryRow[]> {
  const supabase = getServiceClient("getTaskLibrary");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("task_library")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    warn("getTaskLibrary", error);
    return [];
  }
  return ((data ?? []) as QuoteRow[]).map(taskLibraryFromRow);
}
