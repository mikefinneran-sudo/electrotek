// Quote line items — the merged pricing model. See docs/QUOTE-MODULE-MERGE.md.
//
// Pure: no I/O, no env, unit-testable directly (same posture as pricing.ts and
// lifecycle.ts).
//
// The important idea here is that the sqft × rate × visits calculation stops
// being a SECOND pricing path and becomes a LINE GENERATOR. Before the merge,
// a quote's money could come from either `resolveQuote` (sqft model) or from
// add-on rows, and the PDF reconciled them by hand. Now everything lands as
// lines, the lines sum to the total, and the sqft model is just the thing that
// produces the base line.

import { DEFAULT_PRICING, visitsPerMonthFromWeekly } from "./pricing";
import type { PricingConfig, QuoteAddon } from "./types";

/** Where a line came from. Generated lines are replaceable; manual ones are not. */
export type LineOrigin = "manual" | "generated";

/** A line on a quote. Mirrors the `quote_line_items` table. */
export interface QuoteLineItem {
  id?: string;
  inspection_id?: string;
  product_id: number | null;
  sku: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  /** DB-generated: round(quantity * unit_price, 2). Never sent on a write. */
  line_total?: number;
  /** Percentage, so 7 means 7%. */
  tax_rate: number;
  origin: LineOrigin;
  origin_key: string | null;
  sort_order: number;
}

/** What the caller supplies when writing a line. */
export type QuoteLineItemInput = Omit<QuoteLineItem, "id" | "line_total" | "inspection_id">;

/**
 * One row from the operator's line editor.
 *
 * `origin` and `origin_key` are absent by construction, not merely optional: a
 * line arriving through this path is manual, and letting a caller name itself
 * 'generated' would put a client-authored row inside the regeneration's blast
 * radius. `sort_order` is optional because the editor's row order supplies it.
 */
export interface ManualLineInput {
  /** Present when editing an existing manual line; absent when adding one. */
  id?: string;
  product_id?: number | null;
  sku?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
  sort_order?: number;
}

/**
 * First sort_order used for manual lines. Generated lines occupy 0..n (base line
 * then add-ons), so manual rows start well clear of them.
 */
export const MANUAL_SORT_BASE = 100;

export interface QuoteTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/** The walkthrough inputs the base line is generated from. */
export interface BaseLineSource {
  cleanable_sqft?: number | null;
  visits_per_week?: number | string | null;
  quote_rate_per_sqft?: number | null;
  quote_base_monthly?: number | null;
}

/** Stable origin_key for the recurring-service base line. */
export const BASE_LINE_KEY = "base-service";
/** Prefix for add-on-derived lines, so they can't collide with the base key. */
export const ADDON_KEY_PREFIX = "addon:";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Line total for one line. Mirrors the DB's generated column exactly, so the
 * UI preview and the stored value never disagree.
 */
export function lineTotal(line: Pick<QuoteLineItem, "quantity" | "unit_price">): number {
  return round2((finite(line.quantity) ?? 0) * (finite(line.unit_price) ?? 0));
}

/** Tax for one line, from its own rate. Rounded per line, as the DB does. */
export function lineTax(line: Pick<QuoteLineItem, "quantity" | "unit_price" | "tax_rate">): number {
  return round2((lineTotal(line) * (finite(line.tax_rate) ?? 0)) / 100);
}

/**
 * Sum lines into subtotal / tax / total.
 *
 * Tax is summed from PER-LINE rounded amounts rather than applying one rate to
 * the subtotal. That matches the trigger in 0006_quote_line_items.sql, and it is
 * the behaviour a mixed quote needs: taxable product lines alongside
 * non-taxable labour lines cannot be expressed by a single document-level rate.
 */
export function computeTotals(lines: readonly QuoteLineItem[]): QuoteTotals {
  let subtotal = 0;
  let tax = 0;
  for (const line of lines) {
    subtotal = round2(subtotal + lineTotal(line));
    tax = round2(tax + lineTax(line));
  }
  return { subtotal, tax, total: round2(subtotal + tax) };
}

/**
 * The recurring base line, generated from the walkthrough.
 *
 * Returns null when there is not enough to price — the caller then has a quote
 * made only of add-ons or manual lines, which is legitimate (a one-off job).
 *
 * Resolution order matches `resolveQuote`: a keyed monthly base wins over the
 * calculated one, so an operator who typed a negotiated number keeps it.
 */
export function buildBaseLine(
  source: BaseLineSource,
  pricing: PricingConfig = DEFAULT_PRICING,
  taxRate = 0,
): QuoteLineItemInput | null {
  const keyed = finite(source.quote_base_monthly);
  const rate = finite(source.quote_rate_per_sqft);
  const sqft = finite(source.cleanable_sqft);
  const visitsPerMonth = visitsPerMonthFromWeekly(source.visits_per_week, pricing.weeksPerMonth);

  let unitPrice: number | null = null;
  let description = "Recurring service — monthly";

  if (keyed != null) {
    unitPrice = Math.round(keyed);
    description = "Recurring service — monthly (agreed base)";
  } else if (rate != null && sqft != null && sqft > 0 && visitsPerMonth != null) {
    unitPrice = Math.max(pricing.minMonthly, Math.round(sqft * rate * visitsPerMonth));
    description =
      `Recurring service — ${sqft.toLocaleString()} sq ft, ` +
      `${visitsPerMonth} visits/month @ $${rate.toFixed(4)}/sq ft/visit`;
  }

  if (unitPrice == null) return null;

  return {
    product_id: null,
    sku: null,
    description,
    quantity: 1,
    unit_price: unitPrice,
    tax_rate: taxRate,
    origin: "generated",
    origin_key: BASE_LINE_KEY,
    sort_order: 0,
  };
}

/** Stable origin_key for an add-on-derived line. */
export function addonLineKey(addonId: string): string {
  return `${ADDON_KEY_PREFIX}${addonId}`;
}

/**
 * Lines generated from the legacy `quote_addons` rows.
 *
 * Only ENABLED add-ons become lines — a disabled add-on is an option the
 * customer declined, and it belongs in the PDF's "not included" list, not in
 * the money. Unpriced add-ons are skipped rather than added at 0, because a
 * $0 line on a customer-facing quote reads as "free", not "to be determined".
 */
export function buildAddonLines(
  addons: readonly QuoteAddon[],
  taxRate = 0,
  startSortOrder = 1,
): QuoteLineItemInput[] {
  const lines: QuoteLineItemInput[] = [];
  let sort = startSortOrder;
  for (const addon of addons) {
    if (addon.enabled === false) continue;
    const price = finite(addon.price);
    if (price == null) continue;
    lines.push({
      product_id: null,
      sku: null,
      description: addon.name,
      quantity: 1,
      unit_price: price,
      tax_rate: taxRate,
      origin: "generated",
      origin_key: addonLineKey(addon.addon_id),
      sort_order: sort++,
    });
  }
  return lines;
}

/**
 * The full generated set for a quote: base line then add-on lines.
 * Manual lines are the operator's and are never produced here.
 */
export function buildGeneratedLines(
  source: BaseLineSource,
  addons: readonly QuoteAddon[] = [],
  pricing: PricingConfig = DEFAULT_PRICING,
  taxRate = 0,
): QuoteLineItemInput[] {
  const base = buildBaseLine(source, pricing, taxRate);
  const addonLines = buildAddonLines(addons, taxRate, base ? 1 : 0);
  return base ? [base, ...addonLines] : addonLines;
}

/**
 * Merge a freshly generated set over the existing lines.
 *
 * Rules, and the reason for each:
 *  - manual lines are kept untouched — an operator's hand-written line must
 *    survive someone re-opening the walkthrough and changing the sqft
 *  - generated lines are matched by origin_key and updated in place, so the
 *    line keeps its identity (and its sort position) across regenerations
 *  - generated lines whose key is no longer produced are DROPPED — an add-on
 *    that was turned off must stop being charged
 */
export function reconcileLines(
  existing: readonly QuoteLineItem[],
  generated: readonly QuoteLineItemInput[],
): { keep: QuoteLineItem[]; upsert: QuoteLineItemInput[]; removeKeys: string[] } {
  const generatedKeys = new Set(generated.map((l) => l.origin_key).filter(Boolean) as string[]);

  const keep = existing.filter((l) => l.origin === "manual");
  const staleKeys = existing
    .filter((l) => l.origin === "generated" && l.origin_key && !generatedKeys.has(l.origin_key))
    .map((l) => l.origin_key as string);

  return { keep, upsert: [...generated], removeKeys: staleKeys };
}

/**
 * A write plan against `quote_line_items`: rows to insert, rows to update by id,
 * and ids to delete. Nothing here touches `line_total` (generated) or the
 * inspection's subtotal/tax/total (trigger-owned).
 */
export interface LineWritePlan {
  insert: QuoteLineItemInput[];
  update: { id: string; patch: QuoteLineItemInput }[];
  deleteIds: string[];
}

export const EMPTY_LINE_PLAN: LineWritePlan = { insert: [], update: [], deleteIds: [] };

/** True when the plan would touch the database at all. */
export function isEmptyLinePlan(plan: LineWritePlan): boolean {
  return plan.insert.length === 0 && plan.update.length === 0 && plan.deleteIds.length === 0;
}

/**
 * Turn `reconcileLines`' key-level answer into an id-level write plan.
 *
 * This exists because the plan CANNOT be handed to PostgREST as an upsert.
 * The idempotency guard is a PARTIAL unique index
 * (`(inspection_id, origin_key) where origin='generated' and origin_key is not
 * null`), and Postgres will only use a partial unique index as an ON CONFLICT
 * arbiter if the statement repeats the index predicate — which PostgREST has no
 * syntax for. Measured against the live project: `on_conflict=inspection_id,
 * origin_key` with `resolution=merge-duplicates` returns 42P10, "there is no
 * unique or exclusion constraint matching the ON CONFLICT specification".
 *
 * So the match happens here instead: an existing generated line with the same
 * origin_key is UPDATED by its id, keeping the row (and therefore its identity
 * and creation time) across regenerations. It is still not a delete-then-insert
 * — a failure mid-plan leaves the old line intact rather than gone.
 */
export function planGeneratedLines(
  existing: readonly QuoteLineItem[],
  generated: readonly QuoteLineItemInput[],
): LineWritePlan {
  const { removeKeys } = reconcileLines(existing, generated);

  // Only generated rows are candidates for matching. A manual line that happens
  // to carry an origin_key must never be adopted and overwritten by a
  // regeneration — the partial index does not constrain it, and the operator's
  // wording is not ours to replace.
  const byKey = new Map<string, QuoteLineItem>();
  for (const row of existing) {
    if (row.origin !== "generated" || !row.origin_key || !row.id) continue;
    // First row wins. A duplicate key cannot exist behind the unique index, but
    // reading defensively costs nothing and keeps the plan deterministic.
    if (!byKey.has(row.origin_key)) byKey.set(row.origin_key, row);
  }

  const insert: QuoteLineItemInput[] = [];
  const update: { id: string; patch: QuoteLineItemInput }[] = [];

  for (const line of generated) {
    const match = line.origin_key ? byKey.get(line.origin_key) : undefined;
    if (match?.id) update.push({ id: match.id, patch: line });
    else insert.push(line);
  }

  const stale = new Set(removeKeys);
  const deleteIds = existing
    .filter((l) => l.origin === "generated" && l.origin_key && stale.has(l.origin_key) && l.id)
    .map((l) => l.id as string);

  return { insert, update, deleteIds };
}

/**
 * Plan a write for the operator's MANUAL lines, treating `desired` as the full
 * set for this quote.
 *
 * Full-set semantics is what a line editor needs: the operator deletes a row in
 * the UI and it goes away. It is scoped to manual lines only, so a save from the
 * editor can never remove a generated line — those are owned by
 * `planGeneratedLines` and derived from the walkthrough.
 *
 * A desired line with an `id` that does not match an existing MANUAL line is
 * treated as new rather than trusted: otherwise a caller could pass the id of a
 * generated line (or of a line on another quote) and rewrite it through the
 * manual path.
 */
export function planManualLines(
  existing: readonly QuoteLineItem[],
  desired: readonly ManualLineInput[],
): LineWritePlan {
  const existingManual = new Map<string, QuoteLineItem>();
  for (const row of existing) {
    if (row.origin === "manual" && row.id) existingManual.set(row.id, row);
  }

  const insert: QuoteLineItemInput[] = [];
  const update: { id: string; patch: QuoteLineItemInput }[] = [];
  const kept = new Set<string>();

  desired.forEach((line, index) => {
    // The editor's row order is the quote's order. Assigning it here means the
    // caller does not have to keep sort_order consistent by hand.
    const patch: QuoteLineItemInput = {
      product_id: line.product_id ?? null,
      sku: line.sku ?? null,
      description: line.description,
      quantity: finite(line.quantity) ?? 0,
      unit_price: finite(line.unit_price) ?? 0,
      tax_rate: finite(line.tax_rate) ?? 0,
      origin: "manual",
      // Manual lines carry no origin_key: the partial unique index only
      // constrains generated rows, and a key on a manual row would invite
      // planGeneratedLines to match it.
      origin_key: null,
      // Manual rows sort AFTER everything generated, so a regenerate cannot
      // interleave the walkthrough's lines with the operator's.
      sort_order: line.sort_order ?? MANUAL_SORT_BASE + index,
    };

    if (line.id && existingManual.has(line.id)) {
      kept.add(line.id);
      update.push({ id: line.id, patch });
    } else {
      insert.push(patch);
    }
  });

  const deleteIds = [...existingManual.keys()].filter((id) => !kept.has(id));

  return { insert, update, deleteIds };
}
