import { afterEach, describe, expect, it, vi } from "vitest";
import { runGuardedLoad } from "@waltersignal/bananaforce-core";
import { fetchAccountMap, fetchFailedOutboxEvents, fetchSyncRuns } from "./ui";
import type { LedgerAccountMap, LedgerSyncLog } from "./types";

/** A promise plus the handles to settle it, so tests control ordering exactly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

function accountMapRow(externalId: string): LedgerAccountMap {
  return {
    id: externalId,
    connector: "tiller",
    internal_key: "fees",
    external_id: externalId,
    label: null,
    created_at: "",
  };
}

function syncRun(id: string): LedgerSyncLog {
  return {
    id,
    connector: "tiller",
    status: "succeeded",
    started_at: new Date(0).toISOString(),
    finished_at: null,
    records_synced: 0,
    error: null,
    direction: null,
    trigger_source: null,
    idempotency_key: null,
    created_at: new Date(0).toISOString(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAccountMap", () => {
  it("resolves the rows when the response is ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, rows: [accountMapRow("A")] })));
    await expect(fetchAccountMap("/api/accounting", "tiller")).resolves.toEqual([accountMapRow("A")]);
  });

  it("throws with the server's error message when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: "Account map is locked." })),
    );
    await expect(fetchAccountMap("/api/accounting", "tiller")).rejects.toThrow(
      "Account map is locked.",
    );
  });

  it("discards a superseded connector switch: only the newer connector's rows are applied", async () => {
    // AccountMapPanel refires `loadMap` on the `connector` toggle. Switching
    // tiller -> wave quickly must not let tiller's late response overwrite
    // wave's rows — the bug this ticket closes.
    const tiller = deferred<Response>();
    const wave = deferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      return url.includes("connector=wave") ? wave.promise : tiller.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    let applied: LedgerAccountMap[] = [];
    const cancelTiller = runGuardedLoad(
      () => fetchAccountMap("/api/accounting", "tiller"),
      (rows) => {
        applied = rows;
      },
      () => {},
      "fallback",
    );
    // React runs the previous effect's cleanup before the next effect fires.
    cancelTiller();
    runGuardedLoad(
      () => fetchAccountMap("/api/accounting", "wave"),
      (rows) => {
        applied = rows;
      },
      () => {},
      "fallback",
    );

    // The newer (wave) request settles first; the stale (tiller) request
    // arrives late.
    wave.resolve(jsonResponse({ ok: true, rows: [accountMapRow("WAVE-1")] }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    tiller.resolve(jsonResponse({ ok: true, rows: [accountMapRow("TILLER-1")] }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(applied).toEqual([accountMapRow("WAVE-1")]);
  });
});

describe("fetchSyncRuns", () => {
  it("resolves the runs when the response is ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, runs: [syncRun("r1")] })));
    await expect(fetchSyncRuns("/api/accounting")).resolves.toEqual([syncRun("r1")]);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false })));
    await expect(fetchSyncRuns("/api/accounting")).rejects.toThrow("Could not load sync history.");
  });

  it("discards a superseded sync-runs response after exportNow() bumps outboxRefreshKey", async () => {
    // AccountingView's effect refires on `outboxRefreshKey`, which
    // `exportNow()` bumps once the export completes. A user pressing
    // Export now while the pre-export load is still in flight must not let
    // that stale run list overwrite the freshly-triggered one.
    const beforeExport = deferred<Response>();
    const afterExport = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(beforeExport.promise)
      .mockReturnValueOnce(afterExport.promise);
    vi.stubGlobal("fetch", fetchMock);

    let applied: LedgerSyncLog[] = [];
    const cancelBefore = runGuardedLoad(
      () => fetchSyncRuns("/api/accounting"),
      (runs) => {
        applied = runs;
      },
      () => {},
      "fallback",
    );
    cancelBefore();
    runGuardedLoad(
      () => fetchSyncRuns("/api/accounting"),
      (runs) => {
        applied = runs;
      },
      () => {},
      "fallback",
    );

    afterExport.resolve(jsonResponse({ ok: true, runs: [syncRun("after")] }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    beforeExport.resolve(jsonResponse({ ok: true, runs: [syncRun("before")] }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(applied).toEqual([syncRun("after")]);
  });
});

describe("fetchFailedOutboxEvents", () => {
  it("resolves the events when the response is ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, events: [] })));
    await expect(fetchFailedOutboxEvents("/api/accounting")).resolves.toEqual([]);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false })));
    await expect(fetchFailedOutboxEvents("/api/accounting")).rejects.toThrow(
      "Could not load failed exports.",
    );
  });
});
