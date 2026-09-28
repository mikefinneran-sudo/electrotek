import { describe, expect, it } from "vitest";
import {
  initialOfflineSalesState,
  offlineSalesReducer,
  type SubmittedOrderRow,
} from "./offline-sales-state";

function order(id: string): SubmittedOrderRow {
  return {
    id,
    status: "submitted",
    subtotal: 10,
    customer_email: null,
    business_name: null,
    item_count: 1,
  };
}

describe("offlineSalesReducer", () => {
  it("starts in a loading state with no orders or error", () => {
    expect(initialOfflineSalesState).toEqual({ orders: [], loading: true, error: null });
  });

  it("load-start sets loading and clears any prior error, keeping the existing orders", () => {
    const withError = { orders: [order("1")], loading: false, error: "boom" };
    expect(offlineSalesReducer(withError, { type: "load-start" })).toEqual({
      orders: [order("1")],
      loading: true,
      error: null,
    });
  });

  it("load-success replaces orders, clears loading and error", () => {
    const loading = { orders: [order("1")], loading: true, error: null };
    expect(
      offlineSalesReducer(loading, { type: "load-success", orders: [order("2"), order("3")] }),
    ).toEqual({
      orders: [order("2"), order("3")],
      loading: false,
      error: null,
    });
  });

  it("load-error clears loading and sets the message, keeping the last known orders", () => {
    const loading = { orders: [order("1")], loading: true, error: null };
    expect(offlineSalesReducer(loading, { type: "load-error", message: "Could not load orders." })).toEqual({
      orders: [order("1")],
      loading: false,
      error: "Could not load orders.",
    });
  });

  it("clear-error leaves orders and loading untouched", () => {
    const errored = { orders: [order("1")], loading: false, error: "boom" };
    expect(offlineSalesReducer(errored, { type: "clear-error" })).toEqual({
      orders: [order("1")],
      loading: false,
      error: null,
    });
  });
});
