// Pure half of the accepted-quote -> invoice conversion. No I/O, no
// `server-only`, so it is unit-testable directly (the same split billing
// already uses between invoices.ts and server.ts).

/** The subset of an accepted inspection that billing needs. */
export interface AcceptedQuote {
  id: string;
  estimate_number: string;
  /**
   * Trigger-computed total of the quote's line items, tax included. When a quote
   * is priced by line THIS is the amount the customer accepted, and it wins over
   * every calculation below.
   *
   * Optional and structurally typed, like the rest of this interface — a caller
   * that has no line items simply omits it. 0 counts as "not priced by line":
   * the column defaults to 0 on a quote that has no lines.
   */
  total?: number | null;
  /** Keyed monthly base. Null falls back to the rate × sqft calculation. */
  quote_base_monthly?: number | null;
  quote_rate_per_sqft?: number | null;
  cleanable_sqft?: number | null;
  visits_per_week?: number | string | null;
}

/** The subset of a quote add-on that billing needs. */
export interface AcceptedQuoteAddon {
  price?: number | null;
  enabled?: boolean;
}

const WEEKS_PER_MONTH = 4.33;
const MIN_MONTHLY = 200;

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mirror of the quote engine's resolution hierarchy, used only when the caller
 * did not pass a pre-resolved `monthly`. Kept deliberately small: the canonical
 * implementation is resolveQuote() in module-quote-engine/src/pricing.ts, and
 * the app-level wiring passes that result in rather than relying on this.
 */
export function resolveAcceptedQuoteMonthly(
  quote: AcceptedQuote,
  addons: readonly AcceptedQuoteAddon[],
): number | null {
  // A line-priced quote is already summed, by a database trigger, from the exact
  // rows the customer saw. Recomputing it from the sqft model would bill a
  // different number than the one they accepted — it drops manual lines and all
  // tax — so the stored total short-circuits everything else. It also already
  // includes the add-ons, which is why this returns before addonTotal is used.
  const lineTotal = finite(quote.total);
  if (lineTotal != null && lineTotal > 0) return lineTotal;

  const addonTotal = addons
    .filter((a) => a.enabled !== false)
    .reduce((sum, a) => sum + (finite(a.price) ?? 0), 0);

  const base = finite(quote.quote_base_monthly);
  if (base != null) return Math.round(base) + addonTotal;

  const rate = finite(quote.quote_rate_per_sqft);
  const sqft = finite(quote.cleanable_sqft);
  const perWeek = finite(quote.visits_per_week);
  if (rate != null && sqft != null && sqft > 0 && perWeek != null) {
    const visitsPerMonth = Math.round(perWeek * WEEKS_PER_MONTH * 100) / 100;
    return Math.max(MIN_MONTHLY, Math.round(sqft * rate * visitsPerMonth)) + addonTotal;
  }

  return addonTotal > 0 ? addonTotal : null;
}

/** `EST-0042` -> `INV-0042`, so the invoice is traceable to the quote on sight. */
export function invoiceNumberFromEstimate(estimateNumber: string): string {
  const trimmed = String(estimateNumber ?? "").trim();
  if (!trimmed) return "INV-UNNUMBERED";
  return trimmed.startsWith("EST-") ? `INV-${trimmed.slice(4)}` : `INV-${trimmed}`;
}
