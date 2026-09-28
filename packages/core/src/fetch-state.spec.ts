import { describe, expect, it } from "vitest";
import { fetchStateReducer, initialFetchState } from "./fetch-state";

describe("fetchStateReducer", () => {
  it("starts idle", () => {
    expect(initialFetchState<number[]>()).toEqual({ status: "idle" });
  });

  it("load-start moves to loading regardless of the prior state", () => {
    expect(fetchStateReducer<number[]>({ status: "error", message: "boom" }, { type: "load-start" })).toEqual({
      status: "loading",
    });
  });

  it("load-success moves to loaded with the given data", () => {
    expect(
      fetchStateReducer<number[]>({ status: "loading" }, { type: "load-success", data: [1, 2] }),
    ).toEqual({ status: "loaded", data: [1, 2] });
  });

  it("load-error moves to error with the given message", () => {
    expect(
      fetchStateReducer<number[]>({ status: "loading" }, { type: "load-error", message: "Could not load." }),
    ).toEqual({ status: "error", message: "Could not load." });
  });

  it("reset moves back to idle from any state", () => {
    expect(fetchStateReducer<number[]>({ status: "loaded", data: [1] }, { type: "reset" })).toEqual({
      status: "idle",
    });
  });
});
