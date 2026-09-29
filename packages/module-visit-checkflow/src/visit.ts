// Pure, side-effect-free helpers for the visit checkflow: visit-status auto-calc
// and checklist generation from inspection scope text. No I/O, no server-only —
// safe to import from anywhere and unit-test directly (see visit.test.ts).
// Ported from always-be-cleaning's airtable-visits.mjs (status) and
// checklist-from-inspection.mjs + scope-parse.mjs (keyword match).

import type {
  GeneratedChecklist,
  GeneratedItem,
  TaskLibraryEntry,
  VisitStatus,
  VisitStatusInput,
  VisitStatusResult,
} from "./types";

/**
 * Derive a visit's status from its item completions. Only active items count
 * toward the tally (an inactive checklist item is not a task the crew owes).
 *
 *   all done (and at least one task) -> complete
 *   none done                        -> issue
 *   some done                        -> partial
 *
 * With zero active tasks the visit is an `issue` (nothing was actually signed
 * off), matching ABC where tasksTotal === 0 falls through to the non-complete
 * branch.
 */
export function calcVisitStatus(items: readonly VisitStatusInput[]): VisitStatusResult {
  const active = items.filter((i) => i.active !== false);
  const tasksTotal = active.length;
  const tasksDone = active.filter((i) => i.done).length;

  let status: VisitStatus;
  if (tasksTotal > 0 && tasksDone === tasksTotal) status = "complete";
  else if (tasksDone === 0) status = "issue";
  else status = "partial";

  return { tasksDone, tasksTotal, status };
}

// --- photo content-type → file extension ---------------------------------

/**
 * Map a (route-validated) content-type to a safe file extension. The extension
 * is derived from the content-type — never from the user-supplied filename — so
 * a crafted filename cannot inject path segments into the Storage object key.
 * Pure and dependency-free so it can be unit-tested without `server-only`.
 */
export const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// --- checklist generation from scope text --------------------------------

const PER_VISIT = "Per Visit";

/** Split free-text scope into individual task lines (ported from ABC scope-parse). */
function splitScopeText(text: string): string[] {
  const normalized = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[·•|]/g, "\n")
    .trim();

  const lines = normalized
    .split("\n")
    .map((line) => stripListMarker(line))
    .filter(Boolean);

  if (lines.length > 1) return lines;

  const single = lines[0] || normalized;
  if (/[·•|]/.test(text)) {
    return text
      .split(/[·•|]+/)
      .map((s) => stripListMarker(s))
      .filter(Boolean);
  }

  if (/,/.test(single) && !/\d,\d/.test(single)) {
    const commaParts = single
      .split(/,\s*/)
      .map((s) => stripListMarker(s))
      .filter(Boolean);
    if (commaParts.length > 1) return commaParts;
  }

  return single
    .split(/(?<=[.!?])\s+/)
    .map((s) => stripListMarker(s.replace(/[.!?]+$/, "")))
    .filter(Boolean);
}

function stripListMarker(line: string): string {
  return String(line)
    .trim()
    .replace(/^[-–—*•◦▪]+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^[-–—*•◦▪]+\s*/, "")
    .replace(/\s*[·•]\s*$/, "")
    .trim();
}

/**
 * Parse an explicit cadence out of a scope line (e.g. "daily", "3x/week",
 * "weekly", "monthly"). Returns the raw matched text so the crew sees the exact
 * cadence the client asked for; null when the line carries no explicit cadence.
 * Mirrors ABC's scope-parse frequency extraction.
 */
export function parseFrequencyDetail(line: string): string | null {
  const text = String(line);
  const patterns: RegExp[] = [
    /\b\d+\s*(?:x|×|times?)\s*(?:\/|per)?\s*(?:day|wk|week|month|mo)\b/i,
    /\b(?:daily|weekly|biweekly|bi-weekly|monthly|quarterly|nightly)\b/i,
    /\b(?:every|each)\s+(?:day|week|month|visit)\b/i,
    /\bper\s+visit\b/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match) return match[0].trim();
  }
  return null;
}

/**
 * Match a single scope line against the task library by keyword. Returns the
 * matched library entry, or null if no keyword hits. Mirrors ABC's matchToLibrary
 * keyword scan: keywords are pipe-separated, case-insensitive substring tests.
 */
export function matchLineToLibrary(
  line: string,
  library: readonly TaskLibraryEntry[],
): TaskLibraryEntry | null {
  const lower = line.toLowerCase();
  for (const entry of library) {
    const keywords = (entry.match_keywords ?? "")
      .split("|")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (keywords.some((kw) => lower.includes(kw))) return entry;
  }
  return null;
}

/**
 * Build the final checklist item list from an inspection's scope inclusions and
 * the task library. Scope lines that match a library entry become that library
 * task; always-include library entries are appended; the list is de-duped by
 * task name and sorted by sort_order. Pure — the DB insert happens in server.ts.
 *
 * Returns the items plus an `empty` flag so the caller can surface a blank
 * generation (empty scope + no always-include entries) instead of silently
 * persisting an empty checklist.
 */
export function generateChecklistItems(
  scopeText: string | null | undefined,
  library: readonly TaskLibraryEntry[],
): GeneratedChecklist {
  const lines = splitScopeText(scopeText ?? "");

  const matched: GeneratedItem[] = [];
  for (const line of lines) {
    const entry = matchLineToLibrary(line, library);
    if (entry) {
      // Preserve a cadence the client spelled out in the scope line; otherwise
      // fall back to the library default. Mirrors ABC's matchToLibrary:
      // frequency = item.frequency !== PER_VISIT ? item.frequency : match.frequency.
      const parsedDetail = parseFrequencyDetail(line);
      const frequency =
        parsedDetail && parsedDetail.toLowerCase() !== PER_VISIT.toLowerCase()
          ? parsedDetail
          : entry.default_frequency;
      matched.push({
        task: entry.task_name,
        frequency,
        frequency_detail: parsedDetail,
        area: entry.area,
        sort_order: entry.sort_order,
        source: "Scope Inclusion",
      });
    }
  }

  const alwaysInclude: GeneratedItem[] = library
    .filter((e) => e.always_include)
    .map((e) => ({
      task: e.task_name,
      frequency: e.default_frequency,
      frequency_detail: null,
      area: e.area,
      sort_order: e.sort_order,
      source: "Standard Default",
    }));

  const seen = new Set<string>();
  const deduped: GeneratedItem[] = [];
  for (const item of [...matched, ...alwaysInclude]) {
    const key = item.task.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((a, b) => a.sort_order - b.sort_order);
  return { items: deduped, empty: deduped.length === 0 };
}
