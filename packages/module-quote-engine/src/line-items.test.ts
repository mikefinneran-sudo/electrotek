import assert from "node:assert/strict";
import {
  ADDON_KEY_PREFIX,
  BASE_LINE_KEY,
  MANUAL_SORT_BASE,
  addonLineKey,
  buildAddonLines,
  buildBaseLine,
  buildGeneratedLines,
  computeTotals,
  isEmptyLinePlan,
  lineTax,
  lineTotal,
  planGeneratedLines,
  planManualLines,
  reconcileLines,
  type QuoteLineItem,
} from "./line-items";
import { resolveQuote } from "./pricing";
import type { QuoteAddon } from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

function line(over: Partial<QuoteLineItem> = {}): QuoteLineItem {
  return {
    product_id: null,
    sku: null,
    description: "Line",
    quantity: 1,
    unit_price: 0,
    tax_rate: 0,
    origin: "manual",
    origin_key: null,
    sort_order: 0,
    ...over,
  };
}

// --- line arithmetic mirrors the DB generated column ---------------------
check(lineTotal({ quantity: 3, unit_price: 12.5 }) === 37.5, "lineTotal is quantity × unit price");
check(
  lineTotal({ quantity: 3, unit_price: 10.005 }) === 30.02,
  "lineTotal rounds to 2dp like round(quantity * unit_price, 2)",
);
check(lineTotal({ quantity: 0, unit_price: 99 }) === 0, "a zero-quantity line totals 0");

// --- per-line tax --------------------------------------------------------
check(lineTax({ quantity: 1, unit_price: 100, tax_rate: 7 }) === 7, "7% of 100 is 7");
check(lineTax({ quantity: 2, unit_price: 49.99, tax_rate: 7 }) === 7, "tax rounds per line");
check(lineTax({ quantity: 1, unit_price: 100, tax_rate: 0 }) === 0, "a 0% line is untaxed");

// --- totals: per-line tax, not one document rate -------------------------
// The whole point of adopting per-line tax: a quote mixing taxable product with
// non-taxable labour cannot be expressed by a single document-level rate.
{
  const mixed = [
    line({ description: "Supplies", quantity: 1, unit_price: 100, tax_rate: 7 }),
    line({ description: "Labour", quantity: 1, unit_price: 400, tax_rate: 0 }),
  ];
  const t = computeTotals(mixed);
  check(t.subtotal === 500, "subtotal sums line totals");
  check(t.tax === 7, "only the taxable line contributes tax");
  check(t.total === 507, "total is subtotal + tax");
}
{
  const t = computeTotals([]);
  check(t.subtotal === 0 && t.tax === 0 && t.total === 0, "an empty quote totals zero, not NaN");
}

// --- the base line IS the sqft model -------------------------------------
// 10,000 sqft × 0.01 × (3 × 4.33 = 12.99) = 1299 — the same number resolveQuote
// produces, which is the point: one pricing path, not two.
{
  const base = buildBaseLine({
    cleanable_sqft: 10_000,
    visits_per_week: 3,
    quote_rate_per_sqft: 0.01,
  });
  check(base !== null, "a priceable walkthrough yields a base line");
  check(base!.unit_price === 1299, "the base line carries the sqft-model monthly");
  check(base!.origin === "generated", "the base line is generated, not manual");
  check(base!.origin_key === BASE_LINE_KEY, "the base line has the stable base key");
  check(base!.sort_order === 0, "the base line sorts first");
  check(
    base!.description.includes("10,000 sq ft") && base!.description.includes("12.99 visits/month"),
    "the base line description shows the working, not just a number",
  );

  const legacy = resolveQuote({
    cleanable_sqft: 10_000,
    visits_per_week: 3,
    quote_rate_per_sqft: 0.01,
  });
  check(
    base!.unit_price === legacy.monthly,
    "the generated base line agrees with resolveQuote — the models did not fork",
  );
}

// A keyed base wins over the calculation: an operator's negotiated number must
// not be overwritten by the sqft formula.
{
  const base = buildBaseLine({
    cleanable_sqft: 10_000,
    visits_per_week: 3,
    quote_rate_per_sqft: 0.01,
    quote_base_monthly: 1500,
  });
  check(base!.unit_price === 1500, "a keyed base monthly beats the computed one");
  check(base!.description.includes("agreed base"), "the description says it was agreed, not derived");
}

// The min floor still applies through the line path.
check(
  buildBaseLine({ cleanable_sqft: 1_000, visits_per_week: 3, quote_rate_per_sqft: 0.01 })!
    .unit_price === 200,
  "the 200 minimum is enforced on the generated line",
);

check(
  buildBaseLine({ cleanable_sqft: null, visits_per_week: null, quote_rate_per_sqft: null }) === null,
  "an unpriceable walkthrough yields no base line rather than a 0 line",
);

// --- add-on lines --------------------------------------------------------
{
  const addons: QuoteAddon[] = [
    { addon_id: "windows", name: "Window washing", price: 85, enabled: true },
    { addon_id: "odor", name: "Odor control", price: 45, enabled: false },
    { addon_id: "events", name: "Special events", price: null, enabled: true },
  ];
  const lines = buildAddonLines(addons);
  check(lines.length === 1, "only enabled, priced add-ons become lines");
  check(lines[0].description === "Window washing", "the enabled add-on is the line");
  check(
    lines[0].origin_key === `${ADDON_KEY_PREFIX}windows`,
    "an add-on line is keyed by its addon_id",
  );
  check(addonLineKey("windows") === "addon:windows", "addonLineKey is the documented format");
  // An unpriced add-on is deliberately skipped: a $0 line on a customer-facing
  // quote reads as "free", not "to be determined".
  check(
    !lines.some((l) => l.description === "Special events"),
    "an unpriced add-on is omitted rather than quoted at zero",
  );
}

// --- the generated set, end to end --------------------------------------
{
  const generated = buildGeneratedLines(
    { cleanable_sqft: 10_000, visits_per_week: 3, quote_rate_per_sqft: 0.01 },
    [{ addon_id: "windows", name: "Window washing", price: 85, enabled: true }],
  );
  check(generated.length === 2, "base plus one add-on line");
  check(generated[0].origin_key === BASE_LINE_KEY, "base first");
  check(generated[1].sort_order === 1, "add-on lines sort after the base");

  const totals = computeTotals(generated.map((l) => line(l)));
  // 1299 + 85 = 1384 — the same total the pre-merge resolveQuote produced and
  // the same number the live end-to-end run invoiced.
  check(totals.total === 1384, "the line-item total matches the legacy resolved monthly");
}

// --- reconciliation protects operator work ------------------------------
{
  const existing: QuoteLineItem[] = [
    line({ description: "Base", origin: "generated", origin_key: BASE_LINE_KEY, unit_price: 1299 }),
    line({
      description: "Window washing",
      origin: "generated",
      origin_key: "addon:windows",
      unit_price: 85,
    }),
    line({ description: "Negotiated discount", origin: "manual", unit_price: -100, sort_order: 9 }),
  ];

  // Walkthrough re-run with the window add-on turned OFF.
  const generated = buildGeneratedLines({
    cleanable_sqft: 12_000,
    visits_per_week: 3,
    quote_rate_per_sqft: 0.01,
  });
  const { keep, upsert, removeKeys } = reconcileLines(existing, generated);

  check(keep.length === 1, "manual lines are kept");
  check(keep[0].description === "Negotiated discount", "the operator's line survives a regenerate");
  check(
    removeKeys.includes("addon:windows"),
    "a generated line whose source is gone is removed — a switched-off add-on stops being charged",
  );
  check(
    !removeKeys.includes(BASE_LINE_KEY),
    "the base line is updated in place, not removed and re-added",
  );
  check(
    upsert.some((l) => l.origin_key === BASE_LINE_KEY && l.unit_price === 1559),
    "the base line is re-priced from the new sqft (12,000 × 0.01 × 12.99 = 1559)",
  );
}

// --- planGeneratedLines: the id-level write plan -------------------------
//
// This is the layer that exists BECAUSE PostgREST cannot upsert onto the partial
// unique index (measured: 42P10). If these break, the regenerate path silently
// duplicates or drops lines on the live project.
{
  const existing: QuoteLineItem[] = [
    line({
      id: "row-base",
      description: "Recurring service — old price",
      unit_price: 1000,
      origin: "generated",
      origin_key: BASE_LINE_KEY,
      sort_order: 0,
    }),
    line({
      id: "row-windows",
      description: "Window washing",
      unit_price: 85,
      origin: "generated",
      origin_key: addonLineKey("windows"),
      sort_order: 1,
    }),
    line({ id: "row-manual", description: "Negotiated discount", unit_price: -50, sort_order: 100 }),
  ];

  const generated = buildGeneratedLines(
    { cleanable_sqft: 12_000, visits_per_week: 3, quote_rate_per_sqft: 0.01 },
    [{ addon_id: "odor", name: "Odor control", price: 45, enabled: true }],
  );

  const plan = planGeneratedLines(existing, generated);

  check(
    plan.update.some((u) => u.id === "row-base" && u.patch.origin_key === BASE_LINE_KEY),
    "an existing generated line is UPDATED by id, so the row keeps its identity",
  );
  check(
    plan.update.find((u) => u.id === "row-base")?.patch.unit_price === 1559,
    "the matched base row is re-priced from the new walkthrough",
  );
  check(
    plan.insert.some((l) => l.origin_key === addonLineKey("odor")),
    "a newly-enabled add-on is inserted",
  );
  check(
    plan.deleteIds.includes("row-windows"),
    "a generated line whose add-on was switched off is deleted by id",
  );
  check(
    !plan.deleteIds.includes("row-manual"),
    "the operator's manual line is never in the delete set",
  );
  check(
    !plan.update.some((u) => u.id === "row-manual"),
    "the operator's manual line is never rewritten by a regenerate",
  );

  // Running the same regenerate twice must produce no inserts and no deletes —
  // that is the whole point of matching on origin_key.
  const applied: QuoteLineItem[] = [
    ...plan.update.map((u) => line({ ...u.patch, id: u.id })),
    ...plan.insert.map((l, i) => line({ ...l, id: `new-${i}` })),
    line({ id: "row-manual", description: "Negotiated discount", unit_price: -50, sort_order: 100 }),
  ];
  const second = planGeneratedLines(applied, generated);
  check(second.insert.length === 0, "a second identical regenerate inserts nothing");
  check(second.deleteIds.length === 0, "a second identical regenerate deletes nothing");
  check(
    second.update.length === generated.length,
    "a second identical regenerate is all updates — idempotent, not duplicating",
  );
}

// A manual line carrying an origin_key must NOT be adopted by the generated
// matcher. The partial unique index does not constrain it, so a match here would
// let a regenerate overwrite the operator's wording.
{
  const squatter: QuoteLineItem[] = [
    line({ id: "row-squat", description: "Operator's own base line", origin_key: BASE_LINE_KEY }),
  ];
  const generated = buildGeneratedLines({ quote_base_monthly: 500 });
  const plan = planGeneratedLines(squatter, generated);

  check(
    plan.update.length === 0,
    "a manual line is not adopted for update just because it shares an origin_key",
  );
  check(plan.insert.length === 1, "the generated base line is inserted alongside it");
  check(plan.deleteIds.length === 0, "and the manual line is not deleted");
}

// --- planManualLines: full-set semantics, scoped to manual ---------------
{
  const existing: QuoteLineItem[] = [
    line({
      id: "gen-base",
      origin: "generated",
      origin_key: BASE_LINE_KEY,
      unit_price: 1200,
      sort_order: 0,
    }),
    line({ id: "man-keep", description: "Extra supplies", unit_price: 40, sort_order: 100 }),
    line({ id: "man-drop", description: "Removed in the editor", unit_price: 15, sort_order: 101 }),
  ];

  const plan = planManualLines(existing, [
    { id: "man-keep", description: "Extra supplies", quantity: 2, unit_price: 40, tax_rate: 7 },
    { description: "Brand new line", quantity: 1, unit_price: 99 },
  ]);

  check(
    plan.update.length === 1 && plan.update[0].id === "man-keep",
    "an edited manual line is updated by id",
  );
  check(plan.update[0].patch.quantity === 2, "the edit is applied");
  check(plan.insert.length === 1 && plan.insert[0].description === "Brand new line", "a new row inserts");
  check(
    plan.deleteIds.length === 1 && plan.deleteIds[0] === "man-drop",
    "a manual line the editor no longer lists is deleted — full-set semantics",
  );
  check(
    !plan.deleteIds.includes("gen-base"),
    "a generated line is NEVER deleted by a manual save, however the editor posts",
  );
  check(
    plan.insert[0].origin === "manual" && plan.insert[0].origin_key === null,
    "manual rows are forced to origin='manual' with no origin_key",
  );
  check(
    plan.insert[0].sort_order === MANUAL_SORT_BASE + 1,
    "manual rows sort after the generated block, in editor order",
  );
}

// An id the caller does not own must not become a write target: passing a
// generated line's id (or another quote's) through the manual path would let a
// client rewrite a row it has no business touching.
{
  const existing: QuoteLineItem[] = [
    line({ id: "gen-base", origin: "generated", origin_key: BASE_LINE_KEY, unit_price: 1200 }),
  ];
  const plan = planManualLines(existing, [
    { id: "gen-base", description: "Hijack attempt", quantity: 1, unit_price: 1 },
  ]);

  check(plan.update.length === 0, "a generated line's id is not an update target via the manual path");
  check(plan.insert.length === 1, "the row is treated as new instead");
  check(plan.insert[0].origin === "manual", "and lands as manual");
}

// An empty desired set clears the manual lines and leaves generated alone. This
// is what "the operator deleted every hand-written row" has to mean.
{
  const existing: QuoteLineItem[] = [
    line({ id: "gen-base", origin: "generated", origin_key: BASE_LINE_KEY }),
    line({ id: "man-a" }),
    line({ id: "man-b" }),
  ];
  const plan = planManualLines(existing, []);
  check(plan.deleteIds.length === 2, "every manual line is removed");
  check(!plan.deleteIds.includes("gen-base"), "the generated line stays");
  check(isEmptyLinePlan(plan) === false, "a delete-only plan is not an empty plan");
  check(isEmptyLinePlan(planManualLines([], [])) === true, "nothing to do is an empty plan");
}

console.log(`line-items tests passed (${passed})`);
