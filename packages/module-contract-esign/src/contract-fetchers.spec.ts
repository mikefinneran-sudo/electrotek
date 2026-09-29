import { afterEach, describe, expect, it, vi } from "vitest";
import { runGuardedLoad } from "@waltersignal/bananaforce-core";
import { fetchContracts, type ContractRow } from "./ui";

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

/** A promise plus the handles to settle it, so tests control ordering exactly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function contractRow(id: string): ContractRow {
  return {
    id,
    inspection_id: `insp-${id}`,
    status: "sent",
    signer_name: null,
    signed_at: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchContracts", () => {
  it("resolves the contracts when the response is ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, contracts: [contractRow("1")] })));
    await expect(fetchContracts("/api/contract")).resolves.toEqual([contractRow("1")]);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false })));
    await expect(fetchContracts("/api/contract")).rejects.toThrow("Could not load contracts.");
  });

  it("throws when the response body cannot be parsed as JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => {
          throw new Error("bad json");
        },
      } as unknown as Response),
    );
    await expect(fetchContracts("/api/contract")).rejects.toThrow("Could not load contracts.");
  });

  it("discards a superseded initial-load response, keeping only the newer one applied", async () => {
    // ContractView's effect reruns whenever `setupRequired` flips. A slow
    // first request that resolves after a second, faster request must not
    // overwrite the newer list — the bug this ticket closes.
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);

    let applied: ContractRow[] = [];
    const cancelFirst = runGuardedLoad(
      () => fetchContracts("/api/contract"),
      (rows) => {
        applied = rows;
      },
      () => {},
      "fallback",
    );
    cancelFirst();
    runGuardedLoad(
      () => fetchContracts("/api/contract"),
      (rows) => {
        applied = rows;
      },
      () => {},
      "fallback",
    );

    // The newer request settles first, then the stale one arrives late.
    second.resolve(jsonResponse({ ok: true, contracts: [contractRow("newer")] }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    first.resolve(jsonResponse({ ok: true, contracts: [contractRow("older")] }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(applied).toEqual([contractRow("newer")]);
  });
});
