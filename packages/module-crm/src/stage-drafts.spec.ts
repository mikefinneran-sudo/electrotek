import { describe, expect, it } from "vitest";
import { defaultStageDraft } from "./stage-drafts";
import type { PipelineStage } from "./types";

function stage(overrides: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id: "s1",
    pipeline_id: "p1",
    name: "Lead",
    sort_order: 0,
    is_won: false,
    is_lost: false,
    probability_weight: 0.25,
    rotten_days: 14,
    active: true,
    required_fields: [],
    ...overrides,
  };
}

describe("defaultStageDraft", () => {
  it("stringifies numeric fields for form inputs", () => {
    expect(defaultStageDraft(stage())).toEqual({
      name: "Lead",
      probability_weight: "0.25",
      rotten_days: "14",
      active: true,
    });
  });

  it("renders a null rotten_days as an empty string, not the literal 'null'", () => {
    expect(defaultStageDraft(stage({ rotten_days: null })).rotten_days).toBe("");
  });

  it("preserves inactive/zero-weight stages exactly", () => {
    expect(defaultStageDraft(stage({ active: false, probability_weight: 0 }))).toEqual({
      name: "Lead",
      probability_weight: "0",
      rotten_days: "14",
      active: false,
    });
  });
});
