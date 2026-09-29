import assert from "node:assert/strict";
import {
  ADDON_CATALOG,
  STANDARD_SERVICES,
  addonMonthlyTotal,
  computeMonthly,
  formatUsd,
  resolveQuote,
  visitsPerMonthFromWeekly,
} from "./pricing";
import type { QuoteAddon } from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// --- visits per month ----------------------------------------------------
check(
  visitsPerMonthFromWeekly("5") === Math.round(5 * 4.33 * 100) / 100,
  "5×/week resolves to 5 × weeksPerMonth",
);
check(visitsPerMonthFromWeekly("0.5") === Math.round(0.5 * 4.33 * 100) / 100, "biweekly resolves");
check(visitsPerMonthFromWeekly("7") === null, "non-allowed visit value returns null");
check(visitsPerMonthFromWeekly("") === null, "empty visit value returns null");

// --- computeMonthly: the formula ----------------------------------------
// 10,000 sqft × 0.01 × (3 × 4.33 = 12.99) = 1298.99 → rounds to 1299, above floor.
check(
  computeMonthly({ sqft: 10_000, ratePerSqftPerVisit: 0.01, visitsPerWeek: "3" }) === 1299,
  "computeMonthly applies rate × sqft × visits/mo and rounds",
);

// --- computeMonthly: the min floor --------------------------------------
// 1,000 sqft × 0.01 × 12.99 = 129.9 → 130, below 200 floor → floored to 200.
check(
  computeMonthly({ sqft: 1_000, ratePerSqftPerVisit: 0.01, visitsPerWeek: "3" }) === 200,
  "computeMonthly floors small jobs at minMonthly (200)",
);
check(
  computeMonthly({
    sqft: 1_000,
    ratePerSqftPerVisit: 0.01,
    visitsPerWeek: "3",
    minMonthly: 50,
  }) === 130,
  "computeMonthly honors a custom minMonthly override",
);

// --- computeMonthly: incomplete inputs ----------------------------------
check(
  computeMonthly({ sqft: null, ratePerSqftPerVisit: 0.01, visitsPerWeek: "3" }) === null,
  "computeMonthly returns null without sqft",
);
check(
  computeMonthly({ sqft: 10_000, ratePerSqftPerVisit: null, visitsPerWeek: "3" }) === null,
  "computeMonthly returns null without a rate",
);
check(
  computeMonthly({ sqft: 10_000, ratePerSqftPerVisit: 0.01, visitsPerWeek: "7" }) === null,
  "computeMonthly returns null for an invalid visits value",
);

// --- add-on totals: enabled vs disabled ---------------------------------
const addons: QuoteAddon[] = [
  { addon_id: "windows", name: "Window washing", price: 85, enabled: true },
  { addon_id: "odor", name: "Odor control", price: 45, enabled: true },
  { addon_id: "fridge", name: "Break room fridge cleaning", price: 35, enabled: false },
];
check(addonMonthlyTotal(addons) === 130, "addonMonthlyTotal sums only enabled add-ons (85 + 45)");
check(addonMonthlyTotal([]) === 0, "addonMonthlyTotal of no add-ons is 0");
check(
  addonMonthlyTotal([{ addon_id: "x", name: "", price: 99, enabled: true }]) === 0,
  "unnamed add-ons are dropped from the total",
);

// --- resolution hierarchy: base + add-ons -------------------------------
const baseResolved = resolveQuote(
  { quote_base_monthly: 1000, cleanable_sqft: 10_000, visits_per_week: "3" },
  addons,
);
check(baseResolved.source === "base_plus_addons", "keyed base monthly takes precedence");
check(baseResolved.monthly === 1130, "base monthly + enabled add-ons (1000 + 130)");
check(baseResolved.baseMonthly === 1000, "baseMonthly is surfaced");

// --- resolution hierarchy: rate × sqft × visits -------------------------
const computedResolved = resolveQuote(
  { quote_rate_per_sqft: 0.01, cleanable_sqft: 10_000, visits_per_week: "3" },
  addons,
);
check(computedResolved.source === "rate_times_sqft", "falls back to rate × sqft when no base");
check(computedResolved.monthly === 1299 + 130, "computed base + add-ons (1299 + 130)");

// --- resolution hierarchy: add-ons only ---------------------------------
const addonsOnly = resolveQuote({ cleanable_sqft: null, visits_per_week: null }, addons);
check(addonsOnly.source === "addons_only", "add-ons-only when nothing else can price");
check(addonsOnly.monthly === 130, "add-ons-only total is the enabled add-on sum");

// --- resolution hierarchy: nothing to price -----------------------------
const empty = resolveQuote({}, []);
check(empty.source === "none" && empty.monthly === null, "no inputs yields a null quote");

// --- min floor flows through resolveQuote -------------------------------
const floored = resolveQuote(
  { quote_rate_per_sqft: 0.01, cleanable_sqft: 1_000, visits_per_week: "3" },
  [],
);
check(floored.monthly === 200, "resolveQuote applies the min floor on the computed branch");

// --- catalogs export ----------------------------------------------------
check(STANDARD_SERVICES.length === 5, "STANDARD_SERVICES exported with the 5 included services");
check(ADDON_CATALOG.length === 6, "ADDON_CATALOG exported with the 6 optional add-ons");

// --- formatting ---------------------------------------------------------
check(formatUsd(1299) === "$1,299", "formatUsd renders whole-dollar currency");
check(formatUsd(null) === "N/A", "formatUsd handles missing values");

console.log(`pricing tests passed (${passed})`);
