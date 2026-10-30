import assert from "node:assert/strict";
// Imports the PURE half directly: quote-conversion.ts pulls in `server-only`,
// which throws outside a server component and cannot be loaded under tsx.
import {
  invoiceNumberFromEstimate,
  resolveAcceptedQuoteMonthly,
} from "./quote-conversion-pricing";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// --- invoice numbering traces back to the quote --------------------------
check(
  invoiceNumberFromEstimate("EST-0042") === "INV-0042",
  "EST-0042 converts to INV-0042 so the pair is legible on sight",
);
check(
  invoiceNumberFromEstimate("Q-77") === "INV-Q-77",
  "a non-EST prefix is preserved rather than mangled",
);
check(
  invoiceNumberFromEstimate("") === "INV-UNNUMBERED",
  "an empty estimate number still yields a non-empty invoice number (the column is NOT NULL)",
);

// --- monthly resolution mirrors the quote engine's hierarchy -------------
// 1. keyed base + enabled add-ons
check(
  resolveAcceptedQuoteMonthly({ id: "x", estimate_number: "EST-1", quote_base_monthly: 1000 }, [
    { price: 85, enabled: true },
    { price: 45, enabled: false },
  ]) === 1085,
  "keyed base wins and only enabled add-ons are added",
);

// 2. rate × sqft × visits/mo when no keyed base
// 10,000 × 0.01 × (3 × 4.33 = 12.99) = 1299
check(
  resolveAcceptedQuoteMonthly(
    {
      id: "x",
      estimate_number: "EST-1",
      quote_rate_per_sqft: 0.01,
      cleanable_sqft: 10_000,
      visits_per_week: 3,
    },
    [],
  ) === 1299,
  "falls back to rate × sqft × visits per month",
);

// 3. the min floor still applies on the computed branch
check(
  resolveAcceptedQuoteMonthly(
    {
      id: "x",
      estimate_number: "EST-1",
      quote_rate_per_sqft: 0.01,
      cleanable_sqft: 1_000,
      visits_per_week: 3,
    },
    [],
  ) === 200,
  "small jobs are floored at the 200 minimum",
);

// 4. add-ons only
check(
  resolveAcceptedQuoteMonthly({ id: "x", estimate_number: "EST-1" }, [
    { price: 150, enabled: true },
  ]) === 150,
  "add-ons alone can carry the invoice amount",
);

// 5. nothing to price
check(
  resolveAcceptedQuoteMonthly({ id: "x", estimate_number: "EST-1" }, []) === null,
  "an unpriceable quote resolves to null, not 0",
);

// An add-on with no explicit `enabled` counts as enabled, matching the quote
// engine's `enabled !== false` convention.
check(
  resolveAcceptedQuoteMonthly({ id: "x", estimate_number: "EST-1", quote_base_monthly: 500 }, [
    { price: 25 },
  ]) === 525,
  "an add-on defaults to enabled, matching the quote engine",
);

// --- a line-priced quote bills what the customer accepted ----------------
// The quote engine's line items are summed by a DB trigger from the exact rows
// shown on the customer's page. Recomputing from the sqft model would invoice a
// different number: it drops manual lines and all tax.
check(
  resolveAcceptedQuoteMonthly(
    {
      id: "x",
      estimate_number: "EST-1",
      total: 2651.5,
      // Deliberately present and DIFFERENT — these would resolve to 2598.
      quote_rate_per_sqft: 0.01,
      cleanable_sqft: 20000,
      visits_per_week: 3,
    },
    [],
  ) === 2651.5,
  "a line-item total wins over the sqft calculation",
);
check(
  resolveAcceptedQuoteMonthly({ id: "x", estimate_number: "EST-1", total: 1000 }, [
    { price: 85, enabled: true },
  ]) === 1000,
  "the line total already includes add-ons — they are not added again",
);
check(
  resolveAcceptedQuoteMonthly(
    { id: "x", estimate_number: "EST-1", total: 0, quote_base_monthly: 400 },
    [],
  ) === 400,
  "total=0 means 'no lines' (the column's default), so the old path still runs",
);
check(
  resolveAcceptedQuoteMonthly(
    { id: "x", estimate_number: "EST-1", total: null, quote_base_monthly: 400 },
    [],
  ) === 400,
  "a null total falls through too",
);

console.log(`quote-conversion tests passed (${passed})`);
