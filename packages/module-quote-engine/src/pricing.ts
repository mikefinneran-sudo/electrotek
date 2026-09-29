// Pure quote pricing — ported from always-be-cleaning lib/quote-calc.mjs and
// lib/quote-addons.mjs. No I/O, no env: safe to import from anywhere and to
// unit-test directly.

import type {
  AddonCatalogItem,
  ComputeMonthlyInput,
  PricingConfig,
  QuoteAddon,
  QuoteResolutionInput,
  ResolvedQuote,
  StandardService,
} from "./types";

/** Default pricing (matches the active Pricing Config in ABC Quotes). */
export const DEFAULT_PRICING: PricingConfig = {
  ratePerSqftPerVisit: 0.01,
  minMonthly: 200,
  weeksPerMonth: 4.33,
};

/** Allowed visits-per-week values from the intake wizard. */
export const VISIT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "0.5", label: "Every 2 weeks" },
  { value: "1", label: "1× per week" },
  { value: "2", label: "2× per week" },
  { value: "3", label: "3× per week" },
  { value: "5", label: "5× per week (daily, M–F)" },
];

export const ALLOWED_VISIT_VALUES: readonly string[] = VISIT_OPTIONS.map((o) => o.value);

/** Standard services included in every base quote (sqft × rate pricing). */
export const STANDARD_SERVICES: readonly StandardService[] = [
  { name: "Trash & recycling removal", frequency: "Each visit", area: "General" },
  { name: "Dust & vacuum", frequency: "Each visit", area: "General" },
  { name: "Phone & keyboard disinfecting", frequency: "Each visit", area: "General" },
  {
    name: "Complete bathroom sanitation & restocking",
    frequency: "Each visit",
    area: "Restrooms",
  },
  {
    name: "Common area & showroom detailing, incl. beverage stations",
    frequency: "Each visit",
    area: "Common Areas",
  },
];

/** Optional add-ons — priced separately on each quote. examplePrice is a hint only. */
export const ADDON_CATALOG: readonly AddonCatalogItem[] = [
  { id: "windows", name: "Window washing", examplePrice: 85, exampleUnit: "/mo" },
  { id: "odor", name: "Odor control", examplePrice: 45, exampleUnit: "/mo" },
  { id: "events", name: "Special event services", examplePrice: 150, exampleUnit: "/event" },
  { id: "deep-carpet", name: "Deep carpet cleaning", examplePrice: 200, exampleUnit: "/quarter" },
  { id: "floor-buff", name: "Floor buffing / waxing", examplePrice: 175, exampleUnit: "/mo" },
  { id: "fridge", name: "Break room fridge cleaning", examplePrice: 35, exampleUnit: "/mo" },
];

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatAddonExamplePrice(item: AddonCatalogItem | undefined): string {
  if (!item?.examplePrice) return "";
  const unit = item.exampleUnit || "/mo";
  return `$${item.examplePrice.toLocaleString("en-US")}${unit}`;
}

export function formatUsd(value: number | null | undefined, fallback = "N/A"): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Visits per month from a visits-per-week value. Only the allowed wizard values
 * resolve; anything else returns null (matches ABC).
 */
export function visitsPerMonthFromWeekly(
  visitsPerWeek: number | string | null | undefined,
  weeksPerMonth: number = DEFAULT_PRICING.weeksPerMonth,
): number | null {
  if (visitsPerWeek == null || visitsPerWeek === "") return null;
  const v = String(visitsPerWeek);
  if (!ALLOWED_VISIT_VALUES.includes(v)) return null;
  return Math.round(Number(v) * weeksPerMonth * 100) / 100;
}

/**
 * Monthly base from rate × sqft × visits-per-month, floored at minMonthly.
 * Returns null when inputs are incomplete (no sqft, no rate, or an invalid
 * visits value), so callers can branch on "not enough to price yet".
 *
 * Ported from ABC's calculateSuggestedBase + the min floor in
 * calculateMonthlyQuote.
 */
export function computeMonthly(input: ComputeMonthlyInput): number | null {
  const rate = finiteNumber(input.ratePerSqftPerVisit);
  const sqft = finiteNumber(input.sqft);
  const weeksPerMonth = input.weeksPerMonth ?? DEFAULT_PRICING.weeksPerMonth;
  const minMonthly = input.minMonthly ?? DEFAULT_PRICING.minMonthly;
  const visitsPerMonth = visitsPerMonthFromWeekly(input.visitsPerWeek, weeksPerMonth);

  if (rate == null || sqft == null || sqft <= 0 || visitsPerMonth == null) {
    return null;
  }

  const raw = sqft * rate * visitsPerMonth;
  return Math.max(minMonthly, Math.round(raw));
}

/** Suggested base before the floor is applied (the walkthrough hint). */
export function suggestedBase(input: ComputeMonthlyInput): number | null {
  const rate = finiteNumber(input.ratePerSqftPerVisit);
  const sqft = finiteNumber(input.sqft);
  const weeksPerMonth = input.weeksPerMonth ?? DEFAULT_PRICING.weeksPerMonth;
  const visitsPerMonth = visitsPerMonthFromWeekly(input.visitsPerWeek, weeksPerMonth);

  if (rate == null || sqft == null || sqft <= 0 || visitsPerMonth == null) {
    return null;
  }
  return Math.round(sqft * rate * visitsPerMonth);
}

/** Normalize a single add-on row defensively (clamps price, fills id/name). */
function normalizeAddon(row: Partial<QuoteAddon>, index: number): QuoteAddon | null {
  const name = String(row.name ?? "").trim();
  if (!name) return null;
  const price = finiteNumber(row.price);
  return {
    id: row.id,
    inspection_id: row.inspection_id,
    addon_id: row.addon_id ? String(row.addon_id) : `custom-${index + 1}`,
    name,
    price: price != null && price >= 0 ? Math.round(price) : null,
    enabled: row.enabled !== false,
  };
}

export function normalizeAddons(rows: readonly Partial<QuoteAddon>[]): QuoteAddon[] {
  return rows
    .map((row, i) => (row && typeof row === "object" ? normalizeAddon(row, i) : null))
    .filter((row): row is QuoteAddon => row !== null);
}

/** Sum of enabled add-on prices. Disabled add-ons never contribute. */
export function addonMonthlyTotal(addons: readonly Partial<QuoteAddon>[]): number {
  return normalizeAddons(addons)
    .filter((a) => a.enabled)
    .reduce((sum, a) => sum + (a.price != null && Number.isFinite(a.price) ? a.price : 0), 0);
}

/** Enabled, named add-ons (what appears on the quote). */
export function activeAddons(addons: readonly Partial<QuoteAddon>[]): QuoteAddon[] {
  return normalizeAddons(addons).filter((a) => a.enabled && a.name);
}

/** Catalog add-ons not actively included — for the quote's "not included" list. */
export function declinedAddons(addons: readonly Partial<QuoteAddon>[]): QuoteAddon[] {
  const parsed = normalizeAddons(addons);
  const activeIds = new Set(activeAddons(parsed).map((a) => a.addon_id));
  const activeNames = new Set(activeAddons(parsed).map((a) => a.name.toLowerCase()));
  const declined: QuoteAddon[] = [];

  for (const item of ADDON_CATALOG) {
    if (activeIds.has(item.id)) continue;
    if (activeNames.has(item.name.toLowerCase())) continue;
    declined.push({ addon_id: item.id, name: item.name, price: null, enabled: false });
  }

  for (const row of parsed) {
    if (row.enabled || !row.name) continue;
    if (declined.some((d) => d.addon_id === row.addon_id)) continue;
    if (declined.some((d) => d.name.toLowerCase() === row.name.toLowerCase())) continue;
    declined.push(row);
  }

  return declined;
}

/**
 * Resolve the effective monthly quote from a persisted inspection plus its
 * add-ons. Implements ABC's resolution hierarchy:
 *   1. keyed base monthly + add-ons   (quote_base_monthly is set)
 *   2. else rate × sqft × visits/mo, floored at minMonthly, + add-ons
 *   3. else add-ons only, when at least one enabled add-on exists
 *   4. else null (not enough to price yet)
 */
export function resolveQuote(
  inspection: QuoteResolutionInput,
  addons: readonly Partial<QuoteAddon>[] = [],
  pricing: PricingConfig = DEFAULT_PRICING,
): ResolvedQuote {
  const parsedAddons = activeAddons(addons);
  const addonTotal = addonMonthlyTotal(addons);
  const ratePerSqft = finiteNumber(inspection.quote_rate_per_sqft);
  const baseMonthly = finiteNumber(inspection.quote_base_monthly);
  const sqft = finiteNumber(inspection.cleanable_sqft);
  const visitsPerMonth = visitsPerMonthFromWeekly(
    inspection.visits_per_week,
    pricing.weeksPerMonth,
  );

  const hint = suggestedBase({
    sqft: inspection.cleanable_sqft,
    visitsPerWeek: inspection.visits_per_week,
    ratePerSqftPerVisit: ratePerSqft,
    weeksPerMonth: pricing.weeksPerMonth,
  });

  let monthly: number | null = null;
  let source: ResolvedQuote["source"] = "none";

  if (baseMonthly != null) {
    monthly = Math.round(baseMonthly) + addonTotal;
    source = "base_plus_addons";
  } else {
    const computed = computeMonthly({
      sqft: inspection.cleanable_sqft,
      visitsPerWeek: inspection.visits_per_week,
      ratePerSqftPerVisit: ratePerSqft,
      minMonthly: pricing.minMonthly,
      weeksPerMonth: pricing.weeksPerMonth,
    });
    if (computed != null) {
      monthly = computed + addonTotal;
      source = "rate_times_sqft";
    } else if (addonTotal > 0) {
      monthly = addonTotal;
      source = "addons_only";
    }
  }

  const perVisit =
    monthly != null && visitsPerMonth != null && visitsPerMonth > 0
      ? monthly / visitsPerMonth
      : null;

  return {
    monthly,
    baseMonthly: baseMonthly != null ? Math.round(baseMonthly) : null,
    suggestedBase: hint,
    addonTotal,
    addons: parsedAddons,
    ratePerSqft,
    visitsPerMonth,
    perVisit,
    annual: monthly != null ? monthly * 12 : null,
    sqft,
    source,
  };
}
