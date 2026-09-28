// Service-role data access for the visit checkflow. checklists, checklist_items,
// visit_signoffs, visit_item_completions, and visit_photos are staff/crew-only
// (no anon/authenticated RLS policies), so all reads and writes here use the
// service-role key, which bypasses RLS. It also reads quote-engine's inspections
// and task_library (also service-role managed) read-only to generate checklists.
// Guard every call with isVisitCheckflowConfigured() and degrade gracefully when
// env is missing — mirrors the quote-engine module's posture.

import "server-only";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import type {
  Checklist,
  ChecklistItem,
  ChecklistStatus,
  ChecklistWithItems,
  GeneratedItem,
  PhotoRole,
  TaskLibraryEntry,
  VisitItemCompletion,
  VisitPhoto,
  VisitSignoff,
  VisitSignoffDetail,
} from "./types";
import { CHECKLIST_STATUSES, PHOTO_ROLES } from "./types";
import {
  CONTENT_TYPE_TO_EXT,
  calcVisitStatus,
  generateChecklistItems,
} from "./visit";

type Row = Record<string, unknown>;

/** Private Storage bucket that holds visit before/after photo bytes. */
export const VISIT_PHOTOS_BUCKET = "visit-photos";

/** TTL (seconds) for signed photo URLs handed to the signoff UI. */
const SIGNED_URL_TTL = 60 * 10;

/** Hard server-side cap on photos per visit. The UI slice is not a total cap. */
export const MAX_PHOTOS_PER_VISIT = 20;

/** Sentinel returned by uploadVisitPhoto when the per-visit photo cap is hit. */
export type PhotoCapReached = { atCap: true };

export interface VisitItemInput {
  checklist_item_id: number | null;
  done: boolean;
  note?: string | null;
  /** Inactive items are excluded from the done/total tally. */
  active?: boolean;
}

export interface VisitSignoffInput {
  inspection_id: string;
  checklist_id?: string | null;
  signed_by?: string | null;
  visit_date?: string | null;
  notes?: string | null;
  /** Client-generated idempotency key (crypto.randomUUID). */
  submission_id?: string | null;
  items: VisitItemInput[];
}

export interface VisitPhotoInput {
  visit_id: string;
  role?: string | null;
  filename?: string | null;
  content_type?: string | null;
  size?: number | null;
  /** Raw bytes to write to the bucket. */
  body: ArrayBuffer | Uint8Array;
}

const MODULE_LABEL = "Visit checkflow";

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

function checklistStatusOrActive(value: unknown): ChecklistStatus {
  return CHECKLIST_STATUSES.includes(value as ChecklistStatus)
    ? (value as ChecklistStatus)
    : "active";
}

function photoRole(value: unknown): PhotoRole {
  return PHOTO_ROLES.includes(value as PhotoRole) ? (value as PhotoRole) : "visit";
}

/**
 * Env-only check (no I/O), safe to import from anywhere. Without the service-role
 * key the module degrades to setup-required empties rather than throwing.
 */
export function isVisitCheckflowConfigured(): boolean {
  return isServiceRoleConfigured();
}

const getServiceClient = (operation: string) =>
  getServiceClientOrNull(MODULE_LABEL, operation);

// --- row mappers ---------------------------------------------------------

function checklistFromRow(row: Row): Checklist {
  return {
    id: stringOrNull(row.id) ?? "",
    inspection_id: stringOrNull(row.inspection_id) ?? "",
    status: checklistStatusOrActive(row.status),
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

function checklistItemFromRow(row: Row): ChecklistItem {
  return {
    id: numberOrNull(row.id) ?? 0,
    checklist_id: stringOrNull(row.checklist_id) ?? "",
    task: stringOrNull(row.task) ?? "",
    frequency: stringOrNull(row.frequency),
    frequency_detail: stringOrNull(row.frequency_detail),
    area: stringOrNull(row.area),
    sort_order: numberOrNull(row.sort_order) ?? 0,
    active: row.active !== false,
    source: stringOrNull(row.source),
    notes: stringOrNull(row.notes),
  };
}

function visitSignoffFromRow(row: Row): VisitSignoff {
  return {
    id: stringOrNull(row.id) ?? "",
    inspection_id: stringOrNull(row.inspection_id),
    checklist_id: stringOrNull(row.checklist_id),
    visit_date: stringOrNull(row.visit_date),
    completed_at: stringOrNull(row.completed_at),
    signed_by: stringOrNull(row.signed_by),
    status: (stringOrNull(row.status) as VisitSignoff["status"]) ?? null,
    tasks_done: numberOrNull(row.tasks_done),
    tasks_total: numberOrNull(row.tasks_total),
    notes: stringOrNull(row.notes),
    submission_id: stringOrNull(row.submission_id),
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

function completionFromRow(row: Row): VisitItemCompletion {
  return {
    id: numberOrNull(row.id) ?? undefined,
    visit_id: stringOrNull(row.visit_id) ?? undefined,
    checklist_item_id: numberOrNull(row.checklist_item_id),
    done: row.done === true,
    note: stringOrNull(row.note),
  };
}

function photoFromRow(row: Row): VisitPhoto {
  return {
    id: numberOrNull(row.id) ?? undefined,
    visit_id: stringOrNull(row.visit_id) ?? undefined,
    storage_path: stringOrNull(row.storage_path),
    role: photoRole(row.role),
    filename: stringOrNull(row.filename),
    content_type: stringOrNull(row.content_type),
    size: numberOrNull(row.size),
    uploaded_at: stringOrNull(row.uploaded_at) ?? undefined,
  };
}

function taskLibraryFromRow(row: Row): TaskLibraryEntry {
  return {
    task_name: stringOrNull(row.task_name) ?? "",
    default_frequency: stringOrNull(row.default_frequency),
    area: stringOrNull(row.area),
    match_keywords: stringOrNull(row.match_keywords),
    sort_order: numberOrNull(row.sort_order) ?? 0,
    always_include: row.always_include === true,
  };
}

// --- checklists ----------------------------------------------------------

/** The active (non-archived) checklist for an inspection, or null. */
export async function getActiveChecklist(inspectionId: string): Promise<Checklist | null> {
  const supabase = getServiceClient("getActiveChecklist");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("checklists")
    .select("*")
    .eq("inspection_id", inspectionId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    warn("getActiveChecklist", error);
    return null;
  }
  return data ? checklistFromRow(data as Row) : null;
}

export async function getChecklistItems(checklistId: string): Promise<ChecklistItem[]> {
  const supabase = getServiceClient("getChecklistItems");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("checklist_items")
    .select("*")
    .eq("checklist_id", checklistId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    warn("getChecklistItems", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(checklistItemFromRow);
}

/** Load the active checklist + its sorted items for an inspection. */
export async function getChecklistWithItems(
  inspectionId: string,
): Promise<ChecklistWithItems | null> {
  const checklist = await getActiveChecklist(inspectionId);
  if (!checklist) return null;
  const items = await getChecklistItems(checklist.id);
  return { checklist, items };
}

// --- task library (read-only, owned by quote-engine) ---------------------

async function getTaskLibrary(): Promise<TaskLibraryEntry[]> {
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
  return ((data ?? []) as Row[]).map(taskLibraryFromRow);
}

async function getInspectionScope(inspectionId: string): Promise<string | null> {
  const supabase = getServiceClient("getInspectionScope");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("inspections")
    .select("id, scope_inclusions")
    .eq("id", inspectionId)
    .maybeSingle();

  if (error) {
    warn("getInspectionScope", error);
    return null;
  }
  if (!data) return null;
  return stringOrNull((data as Row).scope_inclusions);
}

/**
 * Idempotently generate a checklist for an inspection from its scope text and
 * the task library. If an active checklist already exists, it is returned
 * unchanged (the DB also enforces one active checklist per inspection via a
 * partial unique index). Mirrors ABC's checklist-from-inspection keyword match.
 */
export async function generateChecklistFromInspection(
  inspectionId: string,
): Promise<ChecklistWithItems | null> {
  const supabase = getServiceClient("generateChecklistFromInspection");
  if (!supabase) return null;

  // Confirm the inspection exists before creating a child checklist.
  const scope = await getInspectionScope(inspectionId);
  if (scope === null) {
    const { data: insp } = await supabase
      .from("inspections")
      .select("id")
      .eq("id", inspectionId)
      .maybeSingle();
    if (!insp) {
      warn("generateChecklistFromInspection", "inspection not found");
      return null;
    }
  }

  const library = await getTaskLibrary();
  const { items: generated } = generateChecklistItems(scope, library);

  const existing = await getChecklistWithItems(inspectionId);
  if (existing) {
    // An existing active checklist that already has items is authoritative —
    // return it untouched. But a 0-item active header (e.g. a prior run that
    // inserted the header then failed on the items) must NOT be returned empty:
    // (re)populate it from the current scope so the checklist never gets stuck.
    if (existing.items.length > 0) return existing;
    return populateChecklistItems(existing.checklist, generated);
  }

  const { data: checklistRow, error: checklistError } = await supabase
    .from("checklists")
    .insert({ inspection_id: inspectionId, status: "active" })
    .select("*")
    .single();

  if (checklistError) {
    // A concurrent generate may have raced us to the unique index; fall back to
    // whatever active checklist now exists rather than failing.
    warn("generateChecklistFromInspection", checklistError);
    const raced = await getChecklistWithItems(inspectionId);
    if (raced && raced.items.length === 0) {
      return populateChecklistItems(raced.checklist, generated);
    }
    return raced;
  }

  const checklist = checklistFromRow(checklistRow as Row);
  return populateChecklistItems(checklist, generated);
}

/**
 * Insert the generated rows for a (possibly already-existing) checklist header
 * and return the header with its freshly loaded items. If the item insert fails
 * the header is left active-with-zero-items; we surface that via the warn log so
 * the next generate call repopulates it rather than returning a blank checklist.
 */
async function populateChecklistItems(
  checklist: Checklist,
  generated: GeneratedItem[],
): Promise<ChecklistWithItems> {
  const supabase = getServiceClient("populateChecklistItems");
  if (!supabase) return { checklist, items: [] };

  if (generated.length > 0) {
    const itemRows = generated.map((item, idx) => ({
      checklist_id: checklist.id,
      task: item.task,
      frequency: item.frequency,
      frequency_detail: item.frequency_detail,
      area: item.area,
      sort_order: item.sort_order || (idx + 1) * 10,
      active: true,
      source: item.source,
    }));
    const { error: itemsError } = await supabase.from("checklist_items").insert(itemRows);
    if (itemsError) {
      // Header exists but items failed: do not leave it silently empty — log so
      // it is repopulated on the next generate call.
      warn("generateChecklistFromInspection.items", itemsError);
    }
  }

  const items = await getChecklistItems(checklist.id);
  return { checklist, items };
}

// --- visit signoffs ------------------------------------------------------

export async function listVisits(inspectionId: string): Promise<VisitSignoff[]> {
  const supabase = getServiceClient("listVisits");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("visit_signoffs")
    .select("*")
    .eq("inspection_id", inspectionId)
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    warn("listVisits", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(visitSignoffFromRow);
}

async function findVisitBySubmissionId(submissionId: string): Promise<VisitSignoff | null> {
  const supabase = getServiceClient("findVisitBySubmissionId");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("visit_signoffs")
    .select("*")
    .eq("submission_id", submissionId)
    .maybeSingle();

  if (error) {
    warn("findVisitBySubmissionId", error);
    return null;
  }
  return data ? visitSignoffFromRow(data as Row) : null;
}

/**
 * Create a visit signoff with its per-item completion rows. Idempotent on
 * submission_id: a retried submit with the same key returns the existing visit
 * instead of inserting a duplicate. status/tasks_done/tasks_total are derived
 * here (never trusted from the client) via the pure calcVisitStatus.
 */
export async function createVisitSignoff(
  input: VisitSignoffInput,
): Promise<VisitSignoff | null> {
  const supabase = getServiceClient("createVisitSignoff");
  if (!supabase) return null;

  const submissionId = stringOrNull(input.submission_id);
  if (submissionId) {
    const existing = await findVisitBySubmissionId(submissionId);
    if (existing) return existing;
  }

  const items = Array.isArray(input.items) ? input.items : [];
  const { tasksDone, tasksTotal, status } = calcVisitStatus(
    items.map((i) => ({ done: Boolean(i.done), active: i.active !== false })),
  );

  const nowIso = new Date().toISOString();
  const visitDate = stringOrNull(input.visit_date) ?? nowIso.slice(0, 10);

  const { data: visitRow, error: visitError } = await supabase
    .from("visit_signoffs")
    .insert({
      inspection_id: input.inspection_id,
      checklist_id: stringOrNull(input.checklist_id),
      visit_date: visitDate,
      completed_at: nowIso,
      signed_by: stringOrNull(input.signed_by),
      status,
      tasks_done: tasksDone,
      tasks_total: tasksTotal,
      notes: stringOrNull(input.notes),
      submission_id: submissionId,
    })
    .select("*")
    .single();

  if (visitError) {
    // Unique-violation on submission_id means a concurrent submit won the race;
    // return that visit so the client still gets a clean idempotent result.
    if (submissionId) {
      const existing = await findVisitBySubmissionId(submissionId);
      if (existing) return existing;
    }
    warn("createVisitSignoff", visitError);
    return null;
  }

  const visit = visitSignoffFromRow(visitRow as Row);

  const completionRows = items.map((i) => ({
    visit_id: visit.id,
    checklist_item_id: numberOrNull(i.checklist_item_id),
    done: Boolean(i.done),
    note: stringOrNull(i.note),
  }));
  if (completionRows.length > 0) {
    const { error: completionsError } = await supabase
      .from("visit_item_completions")
      .insert(completionRows);
    if (completionsError) warn("createVisitSignoff.completions", completionsError);
  }

  return visit;
}

export async function getVisitDetail(visitId: string): Promise<VisitSignoffDetail | null> {
  const supabase = getServiceClient("getVisitDetail");
  if (!supabase) return null;

  const { data: visitRow, error: visitError } = await supabase
    .from("visit_signoffs")
    .select("*")
    .eq("id", visitId)
    .maybeSingle();

  if (visitError) {
    warn("getVisitDetail", visitError);
    return null;
  }
  if (!visitRow) return null;

  const [completionsRes, photos] = await Promise.all([
    supabase.from("visit_item_completions").select("*").eq("visit_id", visitId),
    getVisitPhotos(visitId),
  ]);

  if (completionsRes.error) warn("getVisitDetail.completions", completionsRes.error);

  return {
    ...visitSignoffFromRow(visitRow as Row),
    items: ((completionsRes.data ?? []) as Row[]).map(completionFromRow),
    photos,
  };
}

// --- visit photos (Supabase Storage) -------------------------------------

export async function getVisitPhotos(visitId: string): Promise<VisitPhoto[]> {
  const supabase = getServiceClient("getVisitPhotos");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("visit_photos")
    .select("*")
    .eq("visit_id", visitId)
    .order("uploaded_at", { ascending: true });

  if (error) {
    warn("getVisitPhotos", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(photoFromRow);
}

/** Build a private object key for a visit photo. crypto for collision-free keys. */
function buildPhotoPath(visitId: string, role: PhotoRole, contentType: string): string {
  const ext = CONTENT_TYPE_TO_EXT[contentType] ?? "jpg";
  return `${visitId}/${role}-${crypto.randomUUID()}.${ext}`;
}

/**
 * Upload a visit photo to the private `visit-photos` bucket and record its
 * metadata row. Degrades gracefully (returns null) when Storage or the bucket
 * is unavailable — the visit itself is unaffected. Never stores a public URL;
 * reads go through signed URLs.
 */
export async function uploadVisitPhoto(
  input: VisitPhotoInput,
): Promise<VisitPhoto | PhotoCapReached | null> {
  const supabase = getServiceClient("uploadVisitPhoto");
  if (!supabase) return null;

  const role = photoRole(input.role);
  const filename = stringOrNull(input.filename);
  const contentType = stringOrNull(input.content_type) ?? "image/jpeg";

  // Server-side total cap: the UI's per-call slice is not a total limit, so a
  // crafted client could otherwise upload unbounded bytes for one visit.
  const { count, error: countError } = await supabase
    .from("visit_photos")
    .select("id", { count: "exact", head: true })
    .eq("visit_id", input.visit_id);
  if (countError) {
    warn("uploadVisitPhoto.count", countError);
    return null;
  }
  if ((count ?? 0) >= MAX_PHOTOS_PER_VISIT) {
    return { atCap: true };
  }

  const path = buildPhotoPath(input.visit_id, role, contentType);

  const { error: uploadError } = await supabase.storage
    .from(VISIT_PHOTOS_BUCKET)
    .upload(path, input.body, { contentType, upsert: false });

  if (uploadError) {
    // Bucket missing / Storage not provisioned: degrade gracefully.
    warn("uploadVisitPhoto.storage", uploadError);
    return null;
  }

  const { data, error } = await supabase
    .from("visit_photos")
    .insert({
      visit_id: input.visit_id,
      storage_path: path,
      role,
      filename,
      content_type: contentType,
      size: numberOrNull(input.size),
    })
    .select("*")
    .single();

  if (error) {
    warn("uploadVisitPhoto.row", error);
    return null;
  }
  return data ? photoFromRow(data as Row) : null;
}

/** Mint a short-lived signed URL for a stored photo, or null if unavailable. */
export async function getSignedPhotoUrl(storagePath: string): Promise<string | null> {
  const supabase = getServiceClient("getSignedPhotoUrl");
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(VISIT_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);

  if (error) {
    warn("getSignedPhotoUrl", error);
    return null;
  }
  return data?.signedUrl ?? null;
}
