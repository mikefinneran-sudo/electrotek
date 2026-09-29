import assert from "node:assert/strict";
import { normalizeReceiptResponse } from "./receipt";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// --- a well-formed model response ---------------------------------------------

const good = normalizeReceiptResponse({
  vendor: { value: "Home Depot", confidence: 0.97 },
  purchased_on: { value: "2026-08-02", confidence: 0.91 },
  total: { value: 142.87, confidence: 0.95 },
  tax: { value: 9.12, confidence: 0.62 },
  currency: { value: "USD", confidence: 0.99 },
});

check(good.vendor.value === "Home Depot", "vendor passes through");
check(good.purchasedOn.value === "2026-08-02", "snake_case maps to camelCase");
check(good.total.value === 142.87, "total passes through");
check(good.tax.confidence === 0.62, "confidence passes through");

// --- missing fields become null, not zero -------------------------------------

const sparse = normalizeReceiptResponse({ vendor: { value: "Acme", confidence: 0.8 } });
check(sparse.total.value === null, "absent total is null, never 0");
check(sparse.total.confidence === 0, "absent field has zero confidence");
check(sparse.purchasedOn.value === null, "absent date is null");

// --- garbage is rejected rather than coerced ----------------------------------

const garbage = normalizeReceiptResponse({
  total: { value: "not a number", confidence: 0.9 },
  purchased_on: { value: "August 2nd", confidence: 0.9 },
  tax: { value: -5, confidence: 0.9 },
});
check(garbage.total.value === null, "non-numeric total is rejected");
check(garbage.purchasedOn.value === null, "non-ISO date is rejected");
check(garbage.tax.value === null, "negative tax is rejected");

// --- confidence is clamped ----------------------------------------------------

const wild = normalizeReceiptResponse({
  vendor: { value: "X", confidence: 4 },
  total: { value: 1, confidence: -2 },
});
check(wild.vendor.confidence === 1, "confidence clamps to 1");
check(wild.total.confidence === 0, "confidence clamps to 0");

// --- calendar-invalid dates pass the shape regex but must still be rejected ---

const badMonth = normalizeReceiptResponse({
  purchased_on: { value: "2026-13-45", confidence: 0.9 },
});
check(badMonth.purchasedOn.value === null, "month-out-of-range date is rejected");
check(badMonth.purchasedOn.confidence === 0, "rejected date has zero confidence");

const badDay = normalizeReceiptResponse({
  purchased_on: { value: "2026-02-30", confidence: 0.9 },
});
check(badDay.purchasedOn.value === null, "day-out-of-range-for-month date is rejected");

// --- a completely empty response is safe --------------------------------------

const empty = normalizeReceiptResponse(null);
check(empty.vendor.value === null, "null response yields empty proposals");
check(empty.currency.value === null, "null response yields empty currency");

console.log(`receipt.test.ts: ${passed} assertions passed`);
