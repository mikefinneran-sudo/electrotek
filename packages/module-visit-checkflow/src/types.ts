export type ChecklistStatus = "draft" | "active" | "archived";

export const CHECKLIST_STATUSES: readonly ChecklistStatus[] = [
  "draft",
  "active",
  "archived",
];

export type VisitStatus = "complete" | "partial" | "issue";

export const VISIT_STATUSES: readonly VisitStatus[] = [
  "complete",
  "partial",
  "issue",
];

export type PhotoRole = "before" | "after" | "visit";

export const PHOTO_ROLES: readonly PhotoRole[] = ["before", "after", "visit"];

/** A generated checklist header. One active checklist per inspection. */
export interface Checklist {
  id: string;
  inspection_id: string;
  status: ChecklistStatus;
  created_at?: string;
}

/** A single task row on a checklist. Mirrors the `checklist_items` table. */
export interface ChecklistItem {
  id: number;
  checklist_id: string;
  task: string;
  frequency: string | null;
  frequency_detail: string | null;
  area: string | null;
  sort_order: number;
  active: boolean;
  source: string | null;
  notes: string | null;
}

/** A checklist plus its (sorted) items, as loaded for the signoff UI. */
export interface ChecklistWithItems {
  checklist: Checklist;
  items: ChecklistItem[];
}

/** A per-item completion captured during a visit. */
export interface VisitItemCompletion {
  id?: number;
  visit_id?: string;
  checklist_item_id: number | null;
  done: boolean;
  note: string | null;
}

/** A per-visit photo's metadata. Bytes live in the visit-photos bucket. */
export interface VisitPhoto {
  id?: number;
  visit_id?: string;
  storage_path: string | null;
  role: PhotoRole;
  filename: string | null;
  content_type: string | null;
  size: number | null;
  uploaded_at?: string;
}

/** The per-visit signoff header. Mirrors the `visit_signoffs` table. */
export interface VisitSignoff {
  id: string;
  inspection_id: string | null;
  checklist_id: string | null;
  visit_date: string | null;
  completed_at: string | null;
  signed_by: string | null;
  status: VisitStatus | null;
  tasks_done: number | null;
  tasks_total: number | null;
  notes: string | null;
  submission_id: string | null;
  created_at?: string;
}

/** A visit signoff with its item completions and photo rows expanded. */
export interface VisitSignoffDetail extends VisitSignoff {
  items: VisitItemCompletion[];
  photos: VisitPhoto[];
}

/**
 * Inputs to the pure visit-status calculation. `active` items only — inactive
 * checklist items are excluded from the done/total tally (mirrors ABC).
 */
export interface VisitStatusInput {
  done: boolean;
  active?: boolean;
}

/** Result of the status auto-calc: counts plus the derived status. */
export interface VisitStatusResult {
  tasksDone: number;
  tasksTotal: number;
  status: VisitStatus;
}

/** Minimal shape of a task_library row used for keyword matching. */
export interface TaskLibraryEntry {
  task_name: string;
  default_frequency: string | null;
  area: string | null;
  match_keywords: string | null;
  sort_order: number;
  always_include: boolean;
}

/** A checklist item generated from inspection scope, pre-insert. */
export interface GeneratedItem {
  task: string;
  frequency: string | null;
  frequency_detail: string | null;
  area: string | null;
  sort_order: number;
  source: string;
}

/**
 * Result of checklist generation: the (sorted, de-duped) items plus an `empty`
 * flag so the caller can surface a blank result rather than silently persisting
 * an empty checklist.
 */
export interface GeneratedChecklist {
  items: GeneratedItem[];
  empty: boolean;
}
