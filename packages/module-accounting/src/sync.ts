// Pure helpers for the accounting module. No DB, no env, no external imports —
// fully deterministic and safe to import in tests without any mocking.

import type { LedgerSyncLog, SyncStatus } from "./types";

// ---------------------------------------------------------------------------
// Sync run summary
// ---------------------------------------------------------------------------

export interface ConnectorSummary {
  connector: string;
  lastRun: LedgerSyncLog | null;
  successRate: number;
  totalRecords: number;
}

export interface SyncRunSummary {
  byConnector: ConnectorSummary[];
  totalRuns: number;
  totalRecords: number;
}

/**
 * Rolls up an array of sync log rows into per-connector summaries.
 * Returns zero-value summaries rather than throwing on empty input.
 */
export function summarizeSyncRuns(runs: LedgerSyncLog[]): SyncRunSummary {
  if (runs.length === 0) {
    return { byConnector: [], totalRuns: 0, totalRecords: 0 };
  }

  // Group by connector in insertion order.
  const groups = new Map<string, LedgerSyncLog[]>();
  for (const run of runs) {
    const existing = groups.get(run.connector);
    if (existing) {
      existing.push(run);
    } else {
      groups.set(run.connector, [run]);
    }
  }

  let totalRecords = 0;
  const byConnector: ConnectorSummary[] = [];

  for (const [connector, connRuns] of groups) {
    // Most-recent run first (caller may have any order; we pick by started_at).
    const sorted = connRuns
      .slice()
      .sort(
        (a, b) =>
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      );
    const lastRun = sorted[0] ?? null;

    const succeeded = connRuns.filter((r) => r.status === "succeeded").length;
    const successRate =
      connRuns.length > 0 ? succeeded / connRuns.length : 0;

    const connRecords = connRuns.reduce(
      (acc, r) => acc + (r.records_synced ?? 0),
      0,
    );
    totalRecords += connRecords;

    byConnector.push({
      connector,
      lastRun,
      successRate,
      totalRecords: connRecords,
    });
  }

  return { byConnector, totalRuns: runs.length, totalRecords };
}

// ---------------------------------------------------------------------------
// Duration helper
// ---------------------------------------------------------------------------

/**
 * Returns elapsed milliseconds between started_at and finished_at.
 * Returns null when either timestamp is absent or finished_at precedes started_at.
 */
export function syncRunDurationMs(run: LedgerSyncLog): number | null {
  if (!run.finished_at) return null;
  const start = new Date(run.started_at).getTime();
  const end = new Date(run.finished_at).getTime();
  const delta = end - start;
  return delta >= 0 ? delta : null;
}

// ---------------------------------------------------------------------------
// Status transition guard
// ---------------------------------------------------------------------------

/**
 * Legal transitions for a sync run's status field.
 * `event` describes what just happened; `current` is the stored status.
 */
type TransitionEvent = "start" | "succeed" | "fail" | "skip";

const LEGAL_TRANSITIONS: Record<SyncStatus, Partial<Record<TransitionEvent, SyncStatus>>> = {
  pending: {
    start: "running",
    skip: "skipped",
  },
  running: {
    succeed: "succeeded",
    fail: "failed",
    skip: "skipped",
  },
  succeeded: {},
  failed: {},
  skipped: {},
};

/**
 * Returns the next SyncStatus given the current status and event, or null
 * if the transition is illegal (terminal states do not transition).
 */
export function nextSyncStatus(
  current: SyncStatus,
  event: TransitionEvent,
): SyncStatus | null {
  return LEGAL_TRANSITIONS[current]?.[event] ?? null;
}
