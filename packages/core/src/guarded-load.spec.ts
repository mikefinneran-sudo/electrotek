import { describe, expect, it } from "vitest";
import { runGuardedLoad } from "./guarded-load";

/** A promise plus the handles to settle it, so tests control ordering exactly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Drains the microtask queue so `runGuardedLoad`'s async body settles.
 * Deliberately not `setTimeout` — packages/core's tsconfig pulls in neither
 * DOM nor node lib types, so timer globals are not in scope here.
 */
async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("runGuardedLoad", () => {
  it("calls onSuccess with the resolved value", async () => {
    const ok: string[] = [];
    const errors: string[] = [];
    runGuardedLoad(async () => "value", (v) => ok.push(v), (m) => errors.push(m), "fallback");
    await flush();
    expect(ok).toEqual(["value"]);
    expect(errors).toEqual([]);
  });

  it("calls onError with the Error's message on rejection", async () => {
    const ok: string[] = [];
    const errors: string[] = [];
    runGuardedLoad(
      async () => {
        throw new Error("boom");
      },
      (v: string) => ok.push(v),
      (m) => errors.push(m),
      "fallback",
    );
    await flush();
    expect(errors).toEqual(["boom"]);
    expect(ok).toEqual([]);
  });

  it("falls back to the provided message when the rejection is not an Error", async () => {
    const errors: string[] = [];
    runGuardedLoad(
      async () => {
        throw "a bare string";
      },
      () => {},
      (m) => errors.push(m),
      "Could not load.",
    );
    await flush();
    expect(errors).toEqual(["Could not load."]);
  });

  it("discards a superseded response: cleanup before resolution suppresses both callbacks", async () => {
    const ok: string[] = [];
    const errors: string[] = [];
    const d = deferred<string>();
    const cancel = runGuardedLoad(() => d.promise, (v) => ok.push(v), (m) => errors.push(m), "fallback");

    cancel();
    d.resolve("late");
    await flush();

    expect(ok).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("suppresses a late rejection too, so a stale error cannot surface", async () => {
    const errors: string[] = [];
    const d = deferred<string>();
    const cancel = runGuardedLoad(() => d.promise, () => {}, (m) => errors.push(m), "fallback");

    cancel();
    d.reject(new Error("stale failure"));
    await flush();

    expect(errors).toEqual([]);
  });

  it("two overlapping requests: only the newer result is applied, even when the older lands last", async () => {
    const applied: string[] = [];
    const first = deferred<string>();
    const second = deferred<string>();

    // First request starts, then is superseded (React runs cleanup before the
    // next effect when a dependency changes).
    const cancelFirst = runGuardedLoad(() => first.promise, (v) => applied.push(v), () => {}, "fallback");
    cancelFirst();
    runGuardedLoad(() => second.promise, (v) => applied.push(v), () => {}, "fallback");

    // The newer request settles first, then the stale one arrives late.
    second.resolve("newer");
    await flush();
    first.resolve("older");
    await flush();

    expect(applied).toEqual(["newer"]);
  });

  it("does not invoke callbacks synchronously, so an effect body never setState's during render", () => {
    const calls: string[] = [];
    runGuardedLoad(async () => "value", () => calls.push("success"), () => calls.push("error"), "fallback");
    // Nothing has run yet — the async body is queued, not executed inline.
    expect(calls).toEqual([]);
  });
});
