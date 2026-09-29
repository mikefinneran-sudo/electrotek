import { describe, expect, it } from "vitest";
import { categoryForEvent } from "./tiller-export";
import { LEDGER_EVENT_TYPES } from "./types";

describe("expense.recorded ledger event", () => {
  it("is a registered ledger event type", () => {
    expect(LEDGER_EVENT_TYPES).toContain("expense.recorded");
  });

  it("does not disturb the existing event types", () => {
    for (const existing of [
      "payment.succeeded",
      "payment.refunded",
      "invoice.opened",
      "order.submitted",
    ]) {
      expect(LEDGER_EVENT_TYPES).toContain(existing);
    }
  });
});

describe("expense.recorded category mapping", () => {
  it("files an expense as an expense, never as revenue", () => {
    const category = categoryForEvent("expense.recorded");
    expect(category).toBe("expense.purchase");
    // The bug this guards: the default clause returns "revenue.other", which
    // would export every confirmed expense to Tiller as revenue while every
    // "was a row exported?" test still passed.
    expect(category.startsWith("revenue")).toBe(false);
  });
});
