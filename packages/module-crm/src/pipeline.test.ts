import assert from "node:assert/strict";
import { decodeKeysetCursor, encodeKeysetCursor } from "./cursor";
import { openVsClosed, pipelineByStage, weightedPipelineValue } from "./pipeline";
import { escapeIlikePattern } from "./search";
import type { Opportunity, PipelineStage } from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// --- test fixtures ----------------------------------------------------------

const STAGES: PipelineStage[] = [
  {
    id: "s1",
    pipeline_id: "p1",
    name: "Lead",
    sort_order: 0,
    is_won: false,
    is_lost: false,
    active: true,
    probability_weight: 0.1,
    rotten_days: null,
    required_fields: [],
  },
  {
    id: "s2",
    pipeline_id: "p1",
    name: "Qualified",
    sort_order: 1,
    is_won: false,
    is_lost: false,
    active: true,
    probability_weight: 0.25,
    rotten_days: null,
    required_fields: [],
  },
  {
    id: "s3",
    pipeline_id: "p1",
    name: "Proposal",
    sort_order: 2,
    is_won: false,
    is_lost: false,
    active: true,
    probability_weight: 0.5,
    rotten_days: null,
    required_fields: [],
  },
  {
    id: "s4",
    pipeline_id: "p1",
    name: "Won",
    sort_order: 10,
    is_won: true,
    is_lost: false,
    active: true,
    probability_weight: 1,
    rotten_days: null,
    required_fields: [],
  },
  {
    id: "s5",
    pipeline_id: "p1",
    name: "Lost",
    sort_order: 11,
    is_won: false,
    is_lost: true,
    active: true,
    probability_weight: 0,
    rotten_days: null,
    required_fields: [],
  },
];

function makeOpp(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: crypto.randomUUID(),
    account_id: null,
    contact_id: null,
    stage_id: "s1",
    name: "Test opp",
    amount: 0,
    close_date: null,
    status: "open",
    lost_reason: null,
    custom_fields: {},
    deleted_at: null,
    ...overrides,
  };
}

// --- pipelineByStage: basic rollup -----------------------------------------

const opps: Opportunity[] = [
  makeOpp({ stage_id: "s1", amount: 1000, status: "open" }),
  makeOpp({ stage_id: "s1", amount: 2000, status: "open" }),
  makeOpp({ stage_id: "s2", amount: 5000, status: "open" }),
  makeOpp({ stage_id: "s4", amount: 8000, status: "won" }),
];

const rollup = pipelineByStage(opps, STAGES);

check(rollup.length === STAGES.length, "pipelineByStage returns one entry per stage");
check(rollup[0].stage.name === "Lead", "stages are sorted by sort_order");
check(rollup[0].count === 2, "Lead stage has 2 opportunities");
check(rollup[0].totalAmount === 3000, "Lead stage totals 1000 + 2000");
check(rollup[1].count === 1, "Qualified stage has 1 opportunity");
check(rollup[1].totalAmount === 5000, "Qualified stage total is 5000");
check(rollup[2].count === 0, "Proposal stage is empty (count 0)");
check(rollup[2].totalAmount === 0, "Proposal stage totalAmount is 0");
check(rollup[3].count === 1, "Won stage has 1 opportunity");

// --- pipelineByStage: empty input returns zeros ----------------------------

const emptyRollup = pipelineByStage([], STAGES);
check(emptyRollup.length === STAGES.length, "empty opps still returns all stages");
check(
  emptyRollup.every((r) => r.count === 0 && r.totalAmount === 0),
  "all stages have count 0 and totalAmount 0 when no opps",
);

// --- pipelineByStage: opp without stage is skipped -------------------------

const noStageOpp = makeOpp({ stage_id: null });
const rollupWithNull = pipelineByStage([noStageOpp], STAGES);
check(
  rollupWithNull.every((r) => r.count === 0),
  "opp with null stage_id is not counted in any stage",
);

// --- weightedPipelineValue: open status weighted by stage probability -------

const mixedOpps: Opportunity[] = [
  makeOpp({ stage_id: "s1", amount: 1000, status: "open" }),  // 100
  makeOpp({ stage_id: "s2", amount: 2000, status: "open" }),  // 500
  makeOpp({ stage_id: "s4", amount: 9000, status: "won" }),   // excluded (won stage + won status)
  makeOpp({ stage_id: "s5", amount: 3000, status: "lost" }),  // excluded (lost stage + lost status)
  makeOpp({ stage_id: "s3", amount: 500, status: "open" }),   // 250
  makeOpp({ stage_id: "s4", amount: 700, status: "open" }),   // 700; stage legacy is_won is ignored
];

check(
  weightedPipelineValue(mixedOpps, STAGES) === 1550,
  "weightedPipelineValue sums open opp amounts weighted by stage probability",
);
check(
  weightedPipelineValue([], STAGES) === 0,
  "weightedPipelineValue is 0 for empty opps",
);

// --- weightedPipelineValue: won/lost excluded from open sum ----------------

const allClosedOpps: Opportunity[] = [
  makeOpp({ stage_id: "s4", amount: 5000, status: "won" }),
  makeOpp({ stage_id: "s5", amount: 5000, status: "lost" }),
];
check(
  weightedPipelineValue(allClosedOpps, STAGES) === 0,
  "weightedPipelineValue is 0 when all opps are won or lost",
);

// --- keyset cursor helper ---------------------------------------------------

const cursor = {
  createdAt: "2026-06-29T12:34:56.000Z",
  id: "11111111-2222-3333-4444-555555555555",
};
const encoded = encodeKeysetCursor(cursor);
check(
  JSON.stringify(decodeKeysetCursor(encoded)) === JSON.stringify(cursor),
  "keyset cursor round-trips",
);
check(decodeKeysetCursor("not-a-cursor") === null, "malformed keyset cursor decodes to null");
check(
  decodeKeysetCursor(
    encodeKeysetCursor({
      createdAt: "2024-01-15",
      id: "11111111-2222-3333-4444-555555555555",
    }),
  ) === null,
  "bare-date keyset cursor decodes to null",
);

// --- ILIKE escaping ----------------------------------------------------------

check(
  escapeIlikePattern("50%_done\\path") === "50\\%\\_done\\\\path",
  "ILIKE wildcard escaping treats %, _, and backslash literally",
);

// --- openVsClosed: basic split ---------------------------------------------

const splitOpps: Opportunity[] = [
  makeOpp({ status: "open" }),
  makeOpp({ status: "open" }),
  makeOpp({ status: "won" }),
  makeOpp({ status: "lost" }),
];

const { open, closed } = openVsClosed(splitOpps);
check(open.length === 2, "openVsClosed: 2 open opportunities");
check(closed.length === 2, "openVsClosed: 2 closed (won+lost) opportunities");
check(
  closed.every((o) => o.status === "won" || o.status === "lost"),
  "closed contains only won or lost opportunities",
);

// --- openVsClosed: empty input → empty results ----------------------------

const { open: emptyOpen, closed: emptyClosed } = openVsClosed([]);
check(emptyOpen.length === 0, "openVsClosed: empty open on no input");
check(emptyClosed.length === 0, "openVsClosed: empty closed on no input");

console.log(`pipeline tests passed (${passed})`);
