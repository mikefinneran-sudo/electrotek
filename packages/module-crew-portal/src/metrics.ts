// Pure aggregation + metric helpers for the crew portal. No I/O, no env, no
// `server-only` — safe to import anywhere and unit-test directly (see
// metrics.test.ts). Ported from always-be-cleaning's lib/airtable-crm.mjs
// (computeAccountMetrics, buildAccountTimeline, countBy, groupByStatus) and its
// dashboard MRR/pipeline-value math, adapted to the Supabase row shapes.
//
// Monthly revenue is resolved from the quote-engine pricing layer (resolveQuote)
// rather than a stored column, so MRR/LTV stay consistent with the quote the
// client actually accepted. server.ts passes the resolved monthly in; these
// helpers never touch the DB.

import { INSPECTION_STATUSES } from "@waltersignal/bananaforce-module-quote-engine";
import type {
  AccountMetrics,
  CrewPipelineGroup,
  Inspection,
  InspectionStatus,
  Lead,
  StatusCounts,
  TimelineEvent,
  VisitMetricInput,
} from "./types";

/**
 * Open pipeline = quotes in flight (not yet accepted, declined, or expired).
 *
 * 'viewed' belongs here: it is 'sent' plus the knowledge that the customer
 * opened it, which makes it MORE live, not less. Omitting it would drop opened
 * quotes out of pipeline value the moment the prospect showed interest.
 *
 * 'expired' is excluded — an expired quote is dead until staff reissue it.
 */
export const OPEN_PIPELINE_STATUSES: readonly InspectionStatus[] = [
  "drafting",
  "ready_to_send",
  "sent",
  "viewed",
];

function finiteOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Count rows by a string field, defaulting an absent value to "unknown". */
export function countBy<T extends object>(
  rows: readonly T[],
  field: keyof T,
): StatusCounts {
  const out: StatusCounts = {};
  for (const row of rows) {
    const raw = row[field];
    const key = raw == null || raw === "" ? "unknown" : String(raw);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * Group inspections by status into canonical INSPECTION_STATUSES order. Rows
 * with an unrecognized status are dropped from the grouped view (the dashboard
 * counts still surface them via countBy), so the pipeline columns stay stable.
 */
export function groupInspectionsByStatus(
  inspections: readonly Inspection[],
): CrewPipelineGroup[] {
  const byStatus = new Map<InspectionStatus, Inspection[]>();
  for (const status of INSPECTION_STATUSES) byStatus.set(status, []);
  for (const inspection of inspections) {
    const bucket = byStatus.get(inspection.status);
    if (bucket) bucket.push(inspection);
  }
  return INSPECTION_STATUSES.map((status) => ({
    status,
    inspections: byStatus.get(status) ?? [],
  }));
}

/**
 * Sum monthly revenue across accepted inspections only. The caller resolves each
 * inspection's monthly (via quote-engine resolveQuote) and supplies it keyed by
 * inspection id; an unaccepted inspection never contributes to MRR.
 */
export function sumMrr(
  inspections: readonly Inspection[],
  monthlyById: ReadonlyMap<string, number | null>,
): number {
  let total = 0;
  for (const inspection of inspections) {
    if (inspection.status !== "accepted") continue;
    total += finiteOrZero(monthlyById.get(inspection.id));
  }
  return total;
}

/**
 * Sum monthly value across OPEN pipeline inspections (drafting/ready/sent) —
 * the weighted-at-100% pipeline value, mirroring ABC's pipelineValue.
 */
export function sumPipelineValue(
  inspections: readonly Inspection[],
  monthlyById: ReadonlyMap<string, number | null>,
): number {
  let total = 0;
  const open = new Set<InspectionStatus>(OPEN_PIPELINE_STATUSES);
  for (const inspection of inspections) {
    if (!open.has(inspection.status)) continue;
    total += finiteOrZero(monthlyById.get(inspection.id));
  }
  return total;
}

/** Whole months between two dates, floored at 0 (ported from ABC). */
export function monthsBetween(fromIso: string | null, now: Date = new Date()): number {
  if (!fromIso) return 0;
  const start = new Date(fromIso);
  if (Number.isNaN(start.getTime())) return 0;
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Per-account metrics from an inspection's resolved monthly + its visits.
 * `monthly` is the resolved quote monthly (from quote-engine), not a stored
 * field. monthsActive/estimatedLtv are null unless the inspection is accepted —
 * an unaccepted quote is not revenue yet. Ported from ABC computeAccountMetrics.
 */
export function computeAccountMetrics(
  inspection: Pick<Inspection, "status" | "walkthrough_date" | "sent_at">,
  monthly: number | null,
  visits: readonly VisitMetricInput[],
  contractSignedAt: string | null = null,
  now: Date = new Date(),
): AccountMetrics {
  const monthlyRevenue = finiteOrZero(monthly);
  const isActive = inspection.status === "accepted";

  const accountSince =
    contractSignedAt || inspection.sent_at || inspection.walkthrough_date || null;
  const monthsActive = isActive ? monthsBetween(accountSince, now) : null;

  const completedVisitCount = visits.filter((v) => v.status === "complete").length;
  const estimatedLtv = isActive
    ? monthlyRevenue * Math.max(1, monthsActive ?? 1)
    : null;

  return {
    monthlyRevenue,
    projectedAnnual: monthlyRevenue * 12,
    monthsActive,
    estimatedLtv,
    accountSince,
    isActive,
    visitCount: visits.length,
    completedVisitCount,
  };
}

/**
 * Build a newest-first account timeline from the lead, inspection milestones,
 * contract sign date, and visits (capped). Events with no date are skipped.
 * Ported from ABC buildAccountTimeline.
 */
export function buildAccountTimeline(
  inspection: Pick<
    Inspection,
    "status" | "walkthrough_date" | "sent_at" | "office_address"
  >,
  lead: Pick<Lead, "submitted_at" | "source"> | null,
  visits: readonly (VisitMetricInput & {
    id?: string;
    tasks_done?: number | null;
    tasks_total?: number | null;
    signed_by?: string | null;
  })[],
  options: {
    monthly?: number | null;
    contractSignedAt?: string | null;
    checklistGenerated?: boolean;
    visitCap?: number;
  } = {},
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const cap = options.visitCap ?? 12;

  if (lead?.submitted_at) {
    events.push({
      date: lead.submitted_at,
      label: "Website lead",
      detail: lead.source ?? "",
    });
  }
  if (inspection.walkthrough_date) {
    events.push({
      date: inspection.walkthrough_date,
      label: "Walkthrough",
      detail: inspection.office_address ?? "",
    });
  }
  if (inspection.sent_at) {
    events.push({
      date: inspection.sent_at,
      label: "Quote sent",
      detail:
        options.monthly != null && Number.isFinite(options.monthly)
          ? `$${Number(options.monthly).toLocaleString("en-US")}/mo`
          : "",
    });
  }
  if (options.contractSignedAt) {
    events.push({
      date: options.contractSignedAt,
      label: "Contract signed",
      detail: options.checklistGenerated ? "Checklist generated" : "Checklist pending",
    });
  }
  if (inspection.status === "declined" && inspection.sent_at) {
    events.push({
      date: inspection.sent_at,
      label: "Declined",
      detail: "",
    });
  }

  for (const visit of visits.slice(0, cap)) {
    const date = visit.visit_date || visit.completed_at;
    if (!date) continue;
    const done = visit.tasks_done ?? "?";
    const total = visit.tasks_total ?? "?";
    const by = visit.signed_by ? ` · ${visit.signed_by}` : "";
    events.push({
      date,
      label: `Visit ${visit.status ?? "logged"}`,
      detail: `${done}/${total} tasks${by}`,
      visitId: visit.id,
    });
  }

  return events.sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    const sa = Number.isNaN(da) ? 0 : da;
    const sb = Number.isNaN(db) ? 0 : db;
    return sb - sa;
  });
}
