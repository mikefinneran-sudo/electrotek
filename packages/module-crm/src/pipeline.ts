// Pure pipeline aggregation helpers — no DB, no env. Safe to import anywhere
// and to unit-test directly. Operates over Opportunity + PipelineStage data.

import type { Opportunity, PipelineStage } from "./types";

/** Per-stage rollup: count of opportunities and summed amount. */
export interface StageRollup {
  stage: PipelineStage;
  count: number;
  totalAmount: number;
}

/**
 * Group opportunities by stage, returning one StageRollup per stage ordered
 * by stage.sort_order. Stages with no opportunities are still represented
 * (count: 0, totalAmount: 0). Opportunities with no stage_id are skipped.
 */
export function pipelineByStage(
  opps: readonly Opportunity[],
  stages: readonly PipelineStage[],
): StageRollup[] {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const rollupByStageId = new Map<string, StageRollup>(
    sorted.map((s) => [s.id, { stage: s, count: 0, totalAmount: 0 }]),
  );

  for (const opp of opps) {
    if (!opp.stage_id) continue;
    const rollup = rollupByStageId.get(opp.stage_id);
    if (!rollup) continue;
    rollup.count += 1;
    rollup.totalAmount += opp.amount != null ? opp.amount : 0;
  }

  return sorted.map((s) => rollupByStageId.get(s.id)!);
}

/** Weighted pipeline value: sum of each open opportunity amount times its stage probability. */
export function weightedPipelineValue(
  opps: readonly Opportunity[],
  stages: readonly PipelineStage[],
): number {
  const weightByStageId = new Map(stages.map((s) => [s.id, s.probability_weight]));

  return opps
    .filter((o) => o.status === "open" && o.stage_id != null)
    .reduce((sum, o) => sum + (o.amount != null ? o.amount : 0) * (weightByStageId.get(o.stage_id!) ?? 0), 0);
}

/**
 * Split opportunities into open vs closed (won + lost). Closed is any
 * opportunity whose status is 'won' or 'lost'.
 */
export function openVsClosed(opps: readonly Opportunity[]): {
  open: Opportunity[];
  closed: Opportunity[];
} {
  const open: Opportunity[] = [];
  const closed: Opportunity[] = [];
  for (const o of opps) {
    if (o.status === "open") open.push(o);
    else closed.push(o);
  }
  return { open, closed };
}
