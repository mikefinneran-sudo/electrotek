import { describe, expect, it } from "vitest";
import {
  accountMapReducer,
  initialAccountMapState,
  initialPendingOutboxState,
  pendingOutboxReducer,
  type AccountMapState,
  type PendingOutboxState,
} from "./accounting-state";
import type { LedgerAccountMap, LedgerOutboxEvent } from "./types";

function outboxEvent(id: string): LedgerOutboxEvent {
  return {
    id,
    event_type: "payment.succeeded",
    source_module: "ordering",
    source_id: "o1",
    payload: {},
    status: "pending",
    attempts: 0,
    last_error: null,
    idempotency_key: id,
    created_at: "",
    processed_at: null,
  } as LedgerOutboxEvent;
}

function accountMapRow(id: string): LedgerAccountMap {
  return {
    id,
    connector: "tiller",
    internal_key: "fees",
    external_id: id,
    label: null,
    created_at: "",
  };
}

describe("pendingOutboxReducer", () => {
  it("starts loading with no events or error", () => {
    expect(initialPendingOutboxState).toEqual({ events: [], loading: true, error: null });
  });

  it("load-start sets loading and clears any prior error, keeping the last events", () => {
    const state: PendingOutboxState = { events: [outboxEvent("1")], loading: false, error: "boom" };
    expect(pendingOutboxReducer(state, { type: "load-start" })).toEqual({
      events: [outboxEvent("1")],
      loading: true,
      error: null,
    });
  });

  it("load-success replaces events and clears loading/error", () => {
    const state: PendingOutboxState = { events: [], loading: true, error: null };
    expect(
      pendingOutboxReducer(state, { type: "load-success", events: [outboxEvent("1"), outboxEvent("2")] }),
    ).toEqual({
      events: [outboxEvent("1"), outboxEvent("2")],
      loading: false,
      error: null,
    });
  });

  it("load-error clears events, clears loading, and sets the message", () => {
    const state: PendingOutboxState = { events: [outboxEvent("1")], loading: true, error: null };
    expect(
      pendingOutboxReducer(state, { type: "load-error", message: "Could not load waiting exports." }),
    ).toEqual({
      events: [],
      loading: false,
      error: "Could not load waiting exports.",
    });
  });
});

describe("accountMapReducer", () => {
  it("starts with no rows and no error", () => {
    expect(initialAccountMapState).toEqual({ rows: [], error: null });
  });

  it("load-clear clears the error and keeps the last rows", () => {
    const state: AccountMapState = { rows: [accountMapRow("1")], error: "boom" };
    expect(accountMapReducer(state, { type: "load-clear" })).toEqual({
      rows: [accountMapRow("1")],
      error: null,
    });
  });

  it("load-success replaces rows and clears the error", () => {
    const state: AccountMapState = { rows: [], error: "boom" };
    expect(
      accountMapReducer(state, { type: "load-success", rows: [accountMapRow("1"), accountMapRow("2")] }),
    ).toEqual({
      rows: [accountMapRow("1"), accountMapRow("2")],
      error: null,
    });
  });

  it("load-error keeps the last rows and sets the message", () => {
    const state: AccountMapState = { rows: [accountMapRow("1")], error: null };
    expect(
      accountMapReducer(state, { type: "load-error", message: "Could not load account map." }),
    ).toEqual({
      rows: [accountMapRow("1")],
      error: "Could not load account map.",
    });
  });
});
