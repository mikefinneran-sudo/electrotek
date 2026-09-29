import { describe, expect, it } from "vitest";
import { runGuardedLoad } from "@waltersignal/bananaforce-core";
import {
  clientDetailReducer,
  initialClientDetailState,
  initialLeadsListState,
  leadsListReducer,
  resolveApiResult,
  type ApiResult,
} from "./crew-load";

interface TestDetail {
  id: string;
}

interface TestLead {
  id: string;
  status: string;
}

function lead(id: string, status = "new"): TestLead {
  return { id, status };
}

describe("resolveApiResult", () => {
  it("resolves ok:true, returning the keyed value", () => {
    expect(resolveApiResult<string[]>({ ok: true, leads: ["a", "b"] }, "leads", [], "fallback")).toEqual({
      ok: true,
      value: ["a", "b"],
    });
  });

  it("falls back to the default when the key is missing", () => {
    expect(resolveApiResult<string[]>({ ok: true }, "leads", [], "fallback")).toEqual({
      ok: true,
      value: [],
    });
  });

  it("resolves ok:false with the response's error message", () => {
    expect(resolveApiResult({ ok: false, error: "server exploded" }, "leads", [], "fallback")).toEqual({
      ok: false,
      message: "server exploded",
    });
  });

  it("falls back to the default message when ok:false has no error", () => {
    expect(resolveApiResult({ ok: false }, "leads", [], "Could not load leads.")).toEqual({
      ok: false,
      message: "Could not load leads.",
    });
  });
});

/** A promise plus the handles to settle it, so tests control ordering exactly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

// Exercises the exact wiring ui.tsx uses for LeadsTab and ClientDetailTab:
// runGuardedLoad's onSuccess callback feeding straight into
// resolveApiResult. This is the bug WAL-594 closes for both effects —
// LeadsTab re-fires on statusFilter, ClientDetailTab on inspectionId — and
// without the guard, a stale response could land last and overwrite the
// view with data for a filter/client the user already left.
describe("guarded load wiring (runGuardedLoad + resolveApiResult)", () => {
  it("LeadsTab shape: a superseded status-filter fetch cannot overwrite a newer one", async () => {
    const applied: unknown[] = [];
    const setLeads = (leads: unknown) => applied.push(leads);

    const first = deferred<ApiResult>();
    const second = deferred<ApiResult>();

    const cancelFirst = runGuardedLoad(
      () => first.promise,
      (result) => {
        const resolved = resolveApiResult<string[]>(result, "leads", [], "Could not load leads.");
        if (resolved.ok) setLeads(resolved.value);
      },
      () => {},
      "Could not load leads.",
    );
    // Filter changes: React runs the previous effect's cleanup before the
    // next effect.
    cancelFirst();
    runGuardedLoad(
      () => second.promise,
      (result) => {
        const resolved = resolveApiResult<string[]>(result, "leads", [], "Could not load leads.");
        if (resolved.ok) setLeads(resolved.value);
      },
      () => {},
      "Could not load leads.",
    );

    // The newer request resolves first; the stale one arrives late.
    second.resolve({ ok: true, leads: ["new-lead"] });
    await flush();
    first.resolve({ ok: true, leads: ["old-lead"] });
    await flush();

    expect(applied).toEqual([["new-lead"]]);
  });

  it("ClientDetailTab shape: a superseded client fetch cannot overwrite a newer one", async () => {
    const applied: unknown[] = [];
    const setDetail = (detail: unknown) => applied.push(detail);

    const first = deferred<ApiResult>();
    const second = deferred<ApiResult>();

    // Clicking between clients quickly: the effect for the first client is
    // cleaned up as soon as the second client is selected.
    const cancelFirst = runGuardedLoad(
      () => first.promise,
      (result) => {
        const resolved = resolveApiResult<{ id: string } | null>(result, "detail", null, "Could not load the client.");
        if (resolved.ok) setDetail(resolved.value);
      },
      () => {},
      "Could not load the client.",
    );
    cancelFirst();
    runGuardedLoad(
      () => second.promise,
      (result) => {
        const resolved = resolveApiResult<{ id: string } | null>(result, "detail", null, "Could not load the client.");
        if (resolved.ok) setDetail(resolved.value);
      },
      () => {},
      "Could not load the client.",
    );

    second.resolve({ ok: true, detail: { id: "client-b" } });
    await flush();
    first.resolve({ ok: true, detail: { id: "client-a" } });
    await flush();

    expect(applied).toEqual([{ id: "client-b" }]);
  });
});

// LeadsTab's leads+loading reducer (WAL-593). Collapsing the two useState
// calls into one reducer is what lets the reload effect dispatch only from
// inside runGuardedLoad's callbacks, clearing react-hooks/set-state-in-effect.
describe("leadsListReducer", () => {
  it("starts in a loading state with no leads", () => {
    expect(initialLeadsListState<TestLead>()).toEqual({ leads: [], loading: true });
  });

  it("load-start sets loading, keeping the last known leads", () => {
    const ready = { leads: [lead("1")], loading: false };
    expect(leadsListReducer(ready, { type: "load-start" })).toEqual({
      leads: [lead("1")],
      loading: true,
    });
  });

  it("load-success replaces leads and clears loading", () => {
    const loading = { leads: [lead("1")], loading: true };
    expect(
      leadsListReducer(loading, { type: "load-success", leads: [lead("2"), lead("3")] }),
    ).toEqual({ leads: [lead("2"), lead("3")], loading: false });
  });

  it("load-done clears loading without touching leads (the error path)", () => {
    const loading = { leads: [lead("1")], loading: true };
    expect(leadsListReducer(loading, { type: "load-done" })).toEqual({
      leads: [lead("1")],
      loading: false,
    });
  });

  it("lead-updated replaces a single lead by id, leaving the rest and loading untouched", () => {
    const ready = { leads: [lead("1", "new"), lead("2", "new")], loading: false };
    expect(
      leadsListReducer(ready, { type: "lead-updated", lead: lead("2", "won") }),
    ).toEqual({ leads: [lead("1", "new"), lead("2", "won")], loading: false });
  });
});

// ClientDetailTab's detail+loading reducer (WAL-593). Same shape as
// leadsListReducer above.
describe("clientDetailReducer", () => {
  it("starts with no detail, not loading", () => {
    expect(initialClientDetailState<TestDetail>()).toEqual({ detail: null, loading: false });
  });

  it("load-start sets loading, keeping the last known detail", () => {
    const ready = { detail: { id: "a" }, loading: false };
    expect(clientDetailReducer(ready, { type: "load-start" })).toEqual({
      detail: { id: "a" },
      loading: true,
    });
  });

  it("load-success sets detail and clears loading", () => {
    const loading = { detail: null, loading: true };
    expect(clientDetailReducer(loading, { type: "load-success", detail: { id: "b" } })).toEqual({
      detail: { id: "b" },
      loading: false,
    });
  });

  it("load-error clears both detail and loading", () => {
    const loading = { detail: { id: "a" }, loading: true };
    expect(clientDetailReducer(loading, { type: "load-error" })).toEqual({
      detail: null,
      loading: false,
    });
  });

  it("load-success also serves changeStatus's write-back of an updated detail", () => {
    const ready = { detail: { id: "a" }, loading: false };
    expect(clientDetailReducer(ready, { type: "load-success", detail: { id: "a-updated" } })).toEqual({
      detail: { id: "a-updated" },
      loading: false,
    });
  });
});
