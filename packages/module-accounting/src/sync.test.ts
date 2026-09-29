import assert from "node:assert/strict";
import type { LedgerSyncLog } from "./types";
import { nextSyncStatus, summarizeSyncRuns, syncRunDurationMs } from "./sync";

function sampleLog(
  partial: Omit<
    LedgerSyncLog,
    "direction" | "trigger_source" | "idempotency_key"
  > &
    Partial<
      Pick<LedgerSyncLog, "direction" | "trigger_source" | "idempotency_key">
    >,
): LedgerSyncLog {
  return {
    direction: null,
    trigger_source: null,
    idempotency_key: null,
    ...partial,
  };
}

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// ---------------------------------------------------------------------------
// summarizeSyncRuns: empty input
// ---------------------------------------------------------------------------

const emptyResult = summarizeSyncRuns([]);
check(emptyResult.totalRuns === 0, "empty runs → totalRuns 0");
check(emptyResult.totalRecords === 0, "empty runs → totalRecords 0");
check(emptyResult.byConnector.length === 0, "empty runs → byConnector empty");

// ---------------------------------------------------------------------------
// summarizeSyncRuns: single connector rollup
// ---------------------------------------------------------------------------

const tillerRuns: LedgerSyncLog[] = [
  sampleLog({
    id: "00000000-0000-0000-0000-000000000001",
    connector: "tiller",
    status: "succeeded",
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:01:00Z",
    records_synced: 42,
    error: null,
    created_at: "2026-01-01T00:00:00Z",
  }),
  sampleLog({
    id: "00000000-0000-0000-0000-000000000002",
    connector: "tiller",
    status: "failed",
    started_at: "2026-01-02T00:00:00Z",
    finished_at: "2026-01-02T00:00:05Z",
    records_synced: 0,
    error: "network timeout",
    created_at: "2026-01-02T00:00:00Z",
  }),
  sampleLog({
    id: "00000000-0000-0000-0000-000000000003",
    connector: "tiller",
    status: "succeeded",
    started_at: "2026-01-03T00:00:00Z",
    finished_at: "2026-01-03T00:01:30Z",
    records_synced: 10,
    error: null,
    created_at: "2026-01-03T00:00:00Z",
  }),
];

const singleResult = summarizeSyncRuns(tillerRuns);
check(singleResult.totalRuns === 3, "single connector: totalRuns matches input length");
check(singleResult.totalRecords === 52, "single connector: totalRecords sums all records_synced");
check(singleResult.byConnector.length === 1, "single connector: one summary entry");

const tillerSummary = singleResult.byConnector[0]!;
check(tillerSummary.connector === "tiller", "single connector: connector name matches");
check(
  Math.abs(tillerSummary.successRate - 2 / 3) < 1e-9,
  "single connector: successRate is 2/3 (2 succeeded out of 3)",
);
check(tillerSummary.totalRecords === 52, "single connector: per-connector totalRecords");
// lastRun should be the most-recent by started_at (2026-01-03)
check(
  tillerSummary.lastRun?.id === "00000000-0000-0000-0000-000000000003",
  "single connector: lastRun picks the most-recent started_at",
);

// ---------------------------------------------------------------------------
// summarizeSyncRuns: multi-connector rollup
// ---------------------------------------------------------------------------

const multiRuns: LedgerSyncLog[] = [
  ...tillerRuns,
  sampleLog({
    id: "00000000-0000-0000-0000-000000000010",
    connector: "wave",
    status: "skipped",
    started_at: "2026-01-01T06:00:00Z",
    finished_at: "2026-01-01T06:00:00Z",
    records_synced: 0,
    error: null,
    created_at: "2026-01-01T06:00:00Z",
  }),
];

const multiResult = summarizeSyncRuns(multiRuns);
check(multiResult.totalRuns === 4, "multi connector: totalRuns counts all runs");
check(multiResult.byConnector.length === 2, "multi connector: two connector summaries");

const waveEntry = multiResult.byConnector.find((c) => c.connector === "wave");
check(waveEntry !== undefined, "multi connector: wave summary present");
check(waveEntry?.successRate === 0, "wave connector: successRate 0 (only skipped run)");
check(waveEntry?.totalRecords === 0, "wave connector: totalRecords 0 (skipped run)");

// ---------------------------------------------------------------------------
// syncRunDurationMs
// ---------------------------------------------------------------------------

const runWithBothTimestamps: LedgerSyncLog = sampleLog({
  id: "00000000-0000-0000-0000-000000000020",
  connector: "tiller",
  status: "succeeded",
  started_at: "2026-01-01T00:00:00Z",
  finished_at: "2026-01-01T00:01:30Z",
  records_synced: 5,
  error: null,
  created_at: "2026-01-01T00:00:00Z",
});
check(
  syncRunDurationMs(runWithBothTimestamps) === 90_000,
  "syncRunDurationMs: 90 seconds = 90000 ms",
);

const runWithoutFinish: LedgerSyncLog = {
  ...runWithBothTimestamps,
  id: "00000000-0000-0000-0000-000000000021",
  finished_at: null,
};
check(
  syncRunDurationMs(runWithoutFinish) === null,
  "syncRunDurationMs: null when finished_at absent",
);

const runZeroDuration: LedgerSyncLog = {
  ...runWithBothTimestamps,
  id: "00000000-0000-0000-0000-000000000022",
  finished_at: "2026-01-01T00:00:00Z",
};
check(syncRunDurationMs(runZeroDuration) === 0, "syncRunDurationMs: zero when timestamps equal");

// ---------------------------------------------------------------------------
// nextSyncStatus: legal transitions
// ---------------------------------------------------------------------------

check(
  nextSyncStatus("pending", "start") === "running",
  "transition: pending + start → running",
);
check(
  nextSyncStatus("pending", "skip") === "skipped",
  "transition: pending + skip → skipped",
);
check(
  nextSyncStatus("running", "succeed") === "succeeded",
  "transition: running + succeed → succeeded",
);
check(
  nextSyncStatus("running", "fail") === "failed",
  "transition: running + fail → failed",
);
check(
  nextSyncStatus("running", "skip") === "skipped",
  "transition: running + skip → skipped",
);

// ---------------------------------------------------------------------------
// nextSyncStatus: illegal transitions (terminal states)
// ---------------------------------------------------------------------------

check(
  nextSyncStatus("succeeded", "start") === null,
  "transition: succeeded is terminal — start returns null",
);
check(
  nextSyncStatus("failed", "succeed") === null,
  "transition: failed is terminal — succeed returns null",
);
check(
  nextSyncStatus("skipped", "fail") === null,
  "transition: skipped is terminal — fail returns null",
);
check(
  nextSyncStatus("pending", "succeed") === null,
  "transition: pending cannot succeed without running first",
);

console.log(`sync tests passed (${passed})`);
