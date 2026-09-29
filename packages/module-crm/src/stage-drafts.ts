// Pure helper for StageSettingsPanel's per-stage edit buffer.
//
// Split out of ui.tsx (WAL-593) so `defaultStageDraft` can be unit tested
// without a React renderer. It used to be inlined twice — once in an effect
// that pre-seeded every stage's draft into state on mount/`stages` change,
// and once again as the render fallback for `drafts[stage.id]` — which is
// itself what let a stage a user never touched fall through `saveStage`'s
// `if (!draft) return` guard undetected. Removing the seeding effect (it
// only mirrored what the render fallback already computed) meant `saveStage`
// needed the same fallback too, so all three call sites now share this one
// definition instead of drifting.
import type { PipelineStage } from "./types";

export interface StageDraft {
  name: string;
  probability_weight: string;
  rotten_days: string;
  active: boolean;
}

export function defaultStageDraft(stage: PipelineStage): StageDraft {
  return {
    name: stage.name,
    probability_weight: String(stage.probability_weight),
    rotten_days: stage.rotten_days == null ? "" : String(stage.rotten_days),
    active: stage.active,
  };
}
