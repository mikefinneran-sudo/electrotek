// Service-role aggregation for the crew portal. This module is mostly READS plus
// a few status updates across the already-built modules; it owns no new tables.
// Every read/write goes through the shared service-role client
// (data-supabase/service), which BYPASSES RLS — exactly the posture of
// quote-engine/admin/contract-esign/visit-checkflow. The ONLY runtime gate is the
// deny-by-default `authorize` in routes.ts / page.tsx (isStaffRequest()); never
// call these functions outside it.
//
// Cross-module reads: crew-portal reads other modules' tables directly via the
// service-role client (leads, inspections, quote_addons, contracts, checklists,
// checklist_items, visit_signoffs) and imports their EXPORTED TYPES for shape.
// It reuses quote-engine's pure pricing (resolveQuote) so MRR/pipeline value
// match the quote a client actually accepted. It does NOT recreate any table and
// does NOT add staff grants — admin already owns staff/is_staff().

import "server-only";
import {
  attributeValue,
  attributesRecord,
} from "@waltersignal/bananaforce-core";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import { resolveQuote } from "@waltersignal/bananaforce-module-quote-engine/pricing";
import type { QuoteAddon } from "@waltersignal/bananaforce-module-quote-engine";
import type {
  AccountMetrics,
  ChecklistWithItems,
  ClientDetail,
  Contract,
  CrewDashboardData,
  CrewPipelineGroup,
  Inspection,
  InspectionStatus,
  Lead,
  LeadStatus,
  TimelineEvent,
  VisitSignoff,
} from "./types";
import {
  buildAccountTimeline,
  computeAccountMetrics,
  countBy,
  groupInspectionsByStatus,
  sumMrr,
  sumPipelineValue,
} from "./metrics";

type Row = Record<string, unknown>;

// Defensive cap on aggregate reads so a runaway table can't blow up the
// dashboard. Far above expected single-client volume; tune if needed.
const MAX_ROWS = 5000;
const RECENT_LIMIT = 8;

// --- small coercers (mirror the other modules' row mappers) --------------

const MODULE_LABEL = "Crew portal";

const warn = (operation: string, error: unknown) =>
  warnSupabase(MODULE_LABEL, operation, error);

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const INSPECTION_STATUS_SET = new Set<InspectionStatus>([
  "drafting",
  "ready_to_send",
  "sent",
  "accepted",
  "declined",
]);

function statusOrDraft(value: unknown): InspectionStatus {
  return INSPECTION_STATUS_SET.has(value as InspectionStatus)
    ? (value as InspectionStatus)
    : "drafting";
}

// RFC-4122-ish UUID shape. All ids handled here are gen_random_uuid() PKs, so we
// validate before any DB call (caller input is never trusted as an id).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Whitelist a lead status from untrusted input. */
export function isLeadStatus(value: unknown): value is LeadStatus {
  return (
    value === "new" ||
    value === "contacted" ||
    value === "walkthrough_scheduled" ||
    value === "quoted" ||
    value === "won" ||
    value === "lost"
  );
}

/** Whitelist an inspection status from untrusted input. */
export function isInspectionStatus(value: unknown): value is InspectionStatus {
  return INSPECTION_STATUS_SET.has(value as InspectionStatus);
}

// --- row mappers ---------------------------------------------------------

function leadFromRow(row: Row): Lead {
  return {
    id: stringOrNull(row.id) ?? "",
    submitted_at: stringOrNull(row.submitted_at),
    status: stringOrNull(row.status) ?? "new",
    source: stringOrNull(row.source),
    name: stringOrNull(row.name),
    company: stringOrNull(row.company),
    email: stringOrNull(row.email),
    phone: stringOrNull(row.phone),
    office: stringOrNull(row.office),
    notes: stringOrNull(row.notes),
    metadata: attributesRecord(row.metadata),
  };
}

function inspectionFromRow(row: Row): Inspection {
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
    // Deliberately NOT carried. public_token is the customer's accept
    // credential; the crew portal is a field-worker surface with no business
    // issuing or forwarding quote links, and this mapper feeds a mobile view.
    // The column is selected by `select("*")` — dropping it here is the point.
    public_token: null,
    sent_at: stringOrNull(row.sent_at),
    viewed_at: stringOrNull(row.viewed_at),
    accepted_at: stringOrNull(row.accepted_at),
    declined_at: stringOrNull(row.declined_at),
    quote_rate_per_sqft: numberOrNull(row.quote_rate_per_sqft),
    quote_base_monthly: numberOrNull(row.quote_base_monthly),
    // Trigger-maintained by quote-engine (0006_quote_line_items.sql). Read-only
    // here, and defaulted rather than nullable so a row that predates the
    // columns reads as an unpriced quote.
    currency: stringOrNull(row.currency) ?? "usd",
    subtotal: numberOrNull(row.subtotal) ?? 0,
    tax: numberOrNull(row.tax) ?? 0,
    total: numberOrNull(row.total) ?? 0,
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function addonFromRow(row: Row): QuoteAddon {
  return {
    id: numberOrNull(row.id) ?? undefined,
    inspection_id: stringOrNull(row.inspection_id) ?? undefined,
    addon_id: stringOrNull(row.addon_id) ?? "",
    name: stringOrNull(row.name) ?? "",
    price: numberOrNull(row.price),
    enabled: row.enabled !== false,
  };
}

function contractFromRow(row: Row): Contract {
  const status = stringOrNull(row.status);
  return {
    id: stringOrNull(row.id) ?? "",
    inspection_id: stringOrNull(row.inspection_id) ?? "",
    status:
      status === "pending" || status === "sent" || status === "signed" || status === "void"
        ? status
        : "pending",
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

function visitFromRow(row: Row): VisitSignoff {
  const status = stringOrNull(row.status);
  return {
    id: stringOrNull(row.id) ?? "",
    inspection_id: stringOrNull(row.inspection_id),
    checklist_id: stringOrNull(row.checklist_id),
    visit_date: stringOrNull(row.visit_date),
    completed_at: stringOrNull(row.completed_at),
    signed_by: stringOrNull(row.signed_by),
    status:
      status === "complete" || status === "partial" || status === "issue" ? status : null,
    tasks_done: numberOrNull(row.tasks_done),
    tasks_total: numberOrNull(row.tasks_total),
    notes: stringOrNull(row.notes),
    submission_id: stringOrNull(row.submission_id),
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

// --- env + client --------------------------------------------------------

/**
 * Env-only check (no I/O). crew-portal aggregates staff-managed data via the
 * service-role client; without it the module degrades to setup-required empties
 * rather than throwing — same posture as the other modules.
 */
export function isCrewPortalConfigured(): boolean {
  return isServiceRoleConfigured();
}

const getServiceClient = (operation: string) =>
  getServiceClientOrNull(MODULE_LABEL, operation);

// --- raw reads -----------------------------------------------------------

async function readAllInspections(): Promise<Inspection[]> {
  const supabase = getServiceClient("readAllInspections");
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("inspections")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) {
    warn("readAllInspections", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(inspectionFromRow);
}

async function readAddonsByInspection(
  inspectionIds: readonly string[],
): Promise<Map<string, QuoteAddon[]>> {
  const byInspection = new Map<string, QuoteAddon[]>();
  if (inspectionIds.length === 0) return byInspection;
  const supabase = getServiceClient("readAddonsByInspection");
  if (!supabase) return byInspection;

  const { data, error } = await supabase
    .from("quote_addons")
    .select("*")
    .in("inspection_id", inspectionIds as string[]);
  if (error) {
    warn("readAddonsByInspection", error);
    return byInspection;
  }
  for (const raw of (data ?? []) as Row[]) {
    const addon = addonFromRow(raw);
    const key = addon.inspection_id ?? "";
    if (!key) continue;
    const list = byInspection.get(key) ?? [];
    list.push(addon);
    byInspection.set(key, list);
  }
  return byInspection;
}

/**
 * Resolve each inspection's monthly via the quote-engine pricing layer, keyed by
 * inspection id. Pulls add-ons for the supplied inspections in one query so MRR
 * resolution is a single round trip rather than N.
 */
async function resolveMonthlyByInspection(
  inspections: readonly Inspection[],
): Promise<Map<string, number | null>> {
  const ids = inspections.map((i) => i.id).filter((id) => id);
  const addonsByInspection = await readAddonsByInspection(ids);

  const monthlyById = new Map<string, number | null>();
  for (const inspection of inspections) {
    const addons = addonsByInspection.get(inspection.id) ?? [];
    const resolved = resolveQuote(inspection, addons);
    monthlyById.set(inspection.id, resolved.monthly);
  }
  return monthlyById;
}

// --- dashboard -----------------------------------------------------------

/**
 * Dashboard aggregate: MRR (sum of resolved monthly across accepted
 * inspections), open-pipeline value, per-status lead + inspection counts, and
 * recent activity. Reuses quote-engine pricing so MRR matches the accepted
 * quote, not a stored column. Ported from ABC getDashboard.
 */
export async function getDashboard(): Promise<CrewDashboardData> {
  const supabase = getServiceClient("getDashboard");
  if (!supabase) {
    return {
      leadCounts: {},
      pipelineCounts: {},
      mrr: 0,
      pipelineValue: 0,
      activeClientCount: 0,
      newLeadCount: 0,
      recentLeads: [],
      recentInspections: [],
    };
  }

  const [{ data: leadRows, error: leadError }, inspections] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .order("submitted_at", { ascending: false })
      .limit(MAX_ROWS),
    readAllInspections(),
  ]);

  if (leadError) warn("getDashboard:leads", leadError);
  const leads = ((leadRows ?? []) as Row[]).map(leadFromRow);

  const monthlyById = await resolveMonthlyByInspection(inspections);

  const leadCounts = countBy(leads, "status");
  const pipelineCounts = countBy(inspections, "status");
  const activeClientCount = inspections.filter((i) => i.status === "accepted").length;

  return {
    leadCounts,
    pipelineCounts,
    mrr: sumMrr(inspections, monthlyById),
    pipelineValue: sumPipelineValue(inspections, monthlyById),
    activeClientCount,
    newLeadCount: leadCounts.new ?? 0,
    recentLeads: leads.slice(0, RECENT_LIMIT),
    recentInspections: inspections.slice(0, RECENT_LIMIT),
  };
}

// --- leads ---------------------------------------------------------------

/** All leads, newest-first, optionally filtered to a whitelisted status. */
export async function listLeads(status?: LeadStatus): Promise<Lead[]> {
  const supabase = getServiceClient("listLeads");
  if (!supabase) return [];

  let query = supabase
    .from("leads")
    .select("*")
    .order("submitted_at", { ascending: false })
    .limit(MAX_ROWS);
  // Only a whitelisted status reaches the query (caller already narrows the
  // type, but guard again so an unexpected value can't filter on junk).
  if (status && isLeadStatus(status)) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    warn("listLeads", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(leadFromRow);
}

/** Update a lead's status. id is UUID-validated; status is whitelisted. */
export async function updateLeadStatus(
  id: string,
  status: LeadStatus,
): Promise<Lead | null> {
  if (!isUuid(id) || !isLeadStatus(status)) return null;
  const supabase = getServiceClient("updateLeadStatus");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("leads")
    .update({ status })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    warn("updateLeadStatus", error);
    return null;
  }
  return data ? leadFromRow(data as Row) : null;
}

// --- pipeline ------------------------------------------------------------

/** Inspections grouped by status, in canonical order. Ported from ABC pipeline view. */
export async function listPipeline(): Promise<CrewPipelineGroup[]> {
  const inspections = await readAllInspections();
  return groupInspectionsByStatus(inspections);
}

// --- inspection status update --------------------------------------------

const INSPECTION_WRITABLE = new Set(["status", "internal_notes", "sent_at"]);

/**
 * Update an inspection's status and/or internal notes (the two fields the crew
 * pipeline edits). id is UUID-validated; status is whitelisted; internal_notes
 * is capped. Stamps sent_at when transitioning to 'sent' (mirrors quote-engine).
 */
export async function updateInspectionStatus(
  id: string,
  patch: { status?: InspectionStatus; internal_notes?: string | null },
): Promise<Inspection | null> {
  if (!isUuid(id)) return null;
  const supabase = getServiceClient("updateInspectionStatus");
  if (!supabase) return null;

  const update: Row = {};
  if ("status" in patch) {
    if (!isInspectionStatus(patch.status)) return null;
    update.status = patch.status;
    if (patch.status === "sent") update.sent_at = new Date().toISOString();
  }
  if ("internal_notes" in patch) {
    const notes = patch.internal_notes;
    // Cap free-text notes defensively; null clears them.
    update.internal_notes =
      notes == null ? null : String(notes).slice(0, 5000);
  }
  // Drop anything that isn't a writable field (belt-and-suspenders).
  for (const key of Object.keys(update)) {
    if (!INSPECTION_WRITABLE.has(key)) delete update[key];
  }
  if (Object.keys(update).length === 0) return null;

  const { data, error } = await supabase
    .from("inspections")
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    warn("updateInspectionStatus", error);
    return null;
  }
  return data ? inspectionFromRow(data as Row) : null;
}

// --- client detail -------------------------------------------------------

async function getInspectionById(id: string): Promise<Inspection | null> {
  const supabase = getServiceClient("getInspectionById");
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("inspections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    warn("getInspectionById", error);
    return null;
  }
  return data ? inspectionFromRow(data as Row) : null;
}

async function getActiveContract(inspectionId: string): Promise<Contract | null> {
  const supabase = getServiceClient("getActiveContract");
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("inspection_id", inspectionId)
    .neq("status", "void")
    .maybeSingle();
  if (error) {
    warn("getActiveContract", error);
    return null;
  }
  return data ? contractFromRow(data as Row) : null;
}

async function getActiveChecklistWithItems(
  inspectionId: string,
): Promise<ChecklistWithItems | null> {
  const supabase = getServiceClient("getActiveChecklistWithItems");
  if (!supabase) return null;

  const { data: checklistRow, error: checklistError } = await supabase
    .from("checklists")
    .select("*")
    .eq("inspection_id", inspectionId)
    .neq("status", "archived")
    .maybeSingle();
  if (checklistError) {
    warn("getActiveChecklistWithItems:checklist", checklistError);
    return null;
  }
  if (!checklistRow) return null;

  const checklistId = stringOrNull((checklistRow as Row).id) ?? "";
  const checklistStatusRaw = stringOrNull((checklistRow as Row).status);
  const checklistStatus =
    checklistStatusRaw === "draft" ||
    checklistStatusRaw === "active" ||
    checklistStatusRaw === "archived"
      ? checklistStatusRaw
      : "active";

  const { data: itemRows, error: itemsError } = await supabase
    .from("checklist_items")
    .select("*")
    .eq("checklist_id", checklistId)
    .order("sort_order", { ascending: true });
  if (itemsError) {
    warn("getActiveChecklistWithItems:items", itemsError);
  }

  return {
    checklist: {
      id: checklistId,
      inspection_id: inspectionId,
      status: checklistStatus,
      created_at: stringOrNull((checklistRow as Row).created_at) ?? undefined,
    },
    items: ((itemRows ?? []) as Row[]).map((row) => ({
      id: numberOrNull(row.id) ?? 0,
      checklist_id: stringOrNull(row.checklist_id) ?? checklistId,
      task: stringOrNull(row.task) ?? "",
      frequency: stringOrNull(row.frequency),
      frequency_detail: stringOrNull(row.frequency_detail),
      area: stringOrNull(row.area),
      sort_order: numberOrNull(row.sort_order) ?? 0,
      active: row.active !== false,
      source: stringOrNull(row.source),
      notes: stringOrNull(row.notes),
    })),
  };
}

async function listVisitsForInspection(inspectionId: string): Promise<VisitSignoff[]> {
  const supabase = getServiceClient("listVisitsForInspection");
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("visit_signoffs")
    .select("*")
    .eq("inspection_id", inspectionId)
    .order("visit_date", { ascending: false })
    .limit(MAX_ROWS);
  if (error) {
    warn("listVisitsForInspection", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(visitFromRow);
}

/** Find a lead matching the inspection by email, then company (ported from ABC). */
async function findMatchingLead(inspection: Inspection): Promise<Lead | null> {
  const supabase = getServiceClient("findMatchingLead");
  if (!supabase) return null;

  const email = inspection.prospect_email?.trim().toLowerCase();
  if (email) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("email", email)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) return leadFromRow(data as Row);
  }

  const company = inspection.prospect_company?.trim().toLowerCase();
  if (company) {
    const safe = company.replace(/[%_\\]/g, "\\$&");
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .ilike("company", safe)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) return leadFromRow(data as Row);
  }

  return null;
}

/**
 * Full client detail for an inspection: the inspection itself plus its matched
 * lead, active contract, active checklist (+items), visits, and the computed
 * metrics + timeline. id is UUID-validated. Ported from ABC getClientDetail.
 */
export async function getClientDetail(inspectionId: string): Promise<ClientDetail | null> {
  if (!isUuid(inspectionId)) return null;

  const inspection = await getInspectionById(inspectionId);
  if (!inspection) return null;

  const [lead, contract, checklist, visits, addonsByInspection] = await Promise.all([
    findMatchingLead(inspection),
    getActiveContract(inspectionId),
    getActiveChecklistWithItems(inspectionId),
    listVisitsForInspection(inspectionId),
    readAddonsByInspection([inspectionId]),
  ]);

  const addons = addonsByInspection.get(inspectionId) ?? [];
  const monthly = resolveQuote(inspection, addons).monthly;
  const contractSignedAt = contract?.signed_at ?? null;

  const metrics: AccountMetrics = computeAccountMetrics(
    inspection,
    monthly,
    visits,
    contractSignedAt,
  );

  const timeline: TimelineEvent[] = buildAccountTimeline(inspection, lead, visits, {
    monthly,
    contractSignedAt,
    checklistGenerated: checklist != null,
  });

  return { inspection, lead, contract, checklist, visits, metrics, timeline };
}
