// Pure quote lifecycle rules — transitions, expiry, and the customer-safe
// projection. No I/O, no env: safe to import from anywhere (including client
// components) and to unit-test directly, same posture as pricing.ts.
//
// The transition table here MIRRORS the quote_engine_guard_status() trigger in
// 0005_quote_lifecycle.sql. The database is the enforcement point; this copy
// exists so the UI can disable an illegal action instead of surfacing a 500.
// If you change one, change the other.

import { lineTax, lineTotal, type QuoteLineItem } from "./line-items";
import { resolveQuote } from "./pricing";
import type {
  Inspection,
  InspectionStatus,
  PublicQuoteLine,
  PublicQuoteTotals,
  PublicQuoteView,
  QuoteAddon,
} from "./types";

export const STATUS_TRANSITIONS: Readonly<
  Record<InspectionStatus, readonly InspectionStatus[]>
> = {
  drafting: ["ready_to_send"],
  ready_to_send: ["drafting", "sent"],
  sent: ["viewed", "accepted", "declined", "expired"],
  viewed: ["accepted", "declined", "expired"],
  accepted: [],
  declined: ["drafting"],
  expired: ["drafting", "sent"],
};

/** Statuses from which no transition is possible. */
export const TERMINAL_STATUSES: readonly InspectionStatus[] = ["accepted"];

/** Statuses where the quote is live in front of the customer. */
export const CUSTOMER_VISIBLE_STATUSES: readonly InspectionStatus[] = [
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
];

/** Default validity window, in days, applied on the transition into `sent`. */
export const DEFAULT_QUOTE_VALID_DAYS = 30;

export function canTransition(from: InspectionStatus, to: InspectionStatus): boolean {
  if (from === to) return true;
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Human-readable label for a status. Used by staff lists and the customer view. */
export function statusLabel(status: InspectionStatus): string {
  switch (status) {
    case "drafting":
      return "Draft";
    case "ready_to_send":
      return "Ready to send";
    case "sent":
      return "Sent";
    case "viewed":
      return "Viewed";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}

/** `valid_until` for a quote being sent on `fromIso` (defaults to today). */
export function computeValidUntil(
  fromIso?: string | null,
  days: number = DEFAULT_QUOTE_VALID_DAYS,
): string {
  const base = fromIso ? new Date(`${String(fromIso).slice(0, 10)}T12:00:00`) : new Date();
  const d = Number.isNaN(base.getTime()) ? new Date() : base;
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out.toISOString().slice(0, 10);
}

/**
 * Whether the validity window has closed, independent of the stored status.
 *
 * Deliberately date-only and compared against the LOCAL calendar day: a quote
 * valid through the 30th stays acceptable for all of the 30th. Comparing
 * timestamps instead would expire it at midnight UTC, which is mid-afternoon of
 * the 29th in Fort Wayne — a day early, in the customer's disfavour.
 */
export function isQuoteExpired(
  inspection: Pick<Inspection, "valid_until">,
  now: Date = new Date(),
): boolean {
  if (!inspection.valid_until) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return String(inspection.valid_until).slice(0, 10) < today;
}

/**
 * Whether the customer may still act on this quote.
 *
 * Checks the expiry window as well as the stored status, because
 * quote_engine_expire_stale() is unscheduled: a quote can be past valid_until
 * while still stored as 'sent'. Accepting must fail on the DATE, not on whether
 * a sweep happened to have run.
 */
export function isQuoteActionable(
  inspection: Pick<Inspection, "status" | "valid_until">,
  now: Date = new Date(),
): boolean {
  if (inspection.status !== "sent" && inspection.status !== "viewed") return false;
  return !isQuoteExpired(inspection, now);
}

/** Effective status for display — folds an unswept expiry into 'expired'. */
export function effectiveStatus(
  inspection: Pick<Inspection, "status" | "valid_until">,
  now: Date = new Date(),
): InspectionStatus {
  if (
    (inspection.status === "sent" || inspection.status === "viewed") &&
    isQuoteExpired(inspection, now)
  ) {
    return "expired";
  }
  return inspection.status;
}

/**
 * Project one stored line down to the customer-facing shape.
 *
 * `line_total` is recomputed here rather than read from the row, and it is the
 * same arithmetic as the DB's generated column (see `lineTotal`). That covers
 * the one case where the stored value is missing: a line built in memory for a
 * preview has never been through Postgres.
 */
function toPublicQuoteLine(line: QuoteLineItem): PublicQuoteLine {
  return {
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unit_price,
    line_total: line.line_total ?? lineTotal(line),
    tax: lineTax(line),
  };
}

/**
 * Project an inspection down to what the customer is allowed to see.
 *
 * ALLOW-LIST, not a delete-list: fields are copied in explicitly, so a column
 * added to `inspections` later cannot leak into a customer response by default.
 * Everything internal — public_token itself, internal_notes, decision_process,
 * current_cleaner intel, the raw pricing inputs — is absent by construction.
 * The same discipline applies per line: see `toPublicQuoteLine`, which drops
 * product_id / sku / origin / origin_key.
 *
 * NOTE the parameter order: `lines` is third and `now` is fourth. `now` used to
 * be third; it moved because every real caller has lines and only tests pass a
 * clock.
 */
export function toPublicQuoteView(
  inspection: Inspection,
  addons: readonly QuoteAddon[],
  lines: readonly QuoteLineItem[] = [],
  now: Date = new Date(),
): PublicQuoteView {
  const quote = resolveQuote(inspection, addons);
  // Totals come from the INSPECTION, not from summing the lines here: the
  // trigger owns them, and showing a customer a number this code derived would
  // let the document disagree with the database it was issued from.
  const totals: PublicQuoteTotals | null = lines.length
    ? {
        subtotal: inspection.subtotal,
        tax: inspection.tax,
        total: inspection.total,
        currency: inspection.currency,
      }
    : null;

  return {
    estimate_number: inspection.estimate_number,
    status: effectiveStatus(inspection, now),
    prospect_name: inspection.prospect_name,
    prospect_company: inspection.prospect_company,
    office_address: inspection.office_address,
    walkthrough_date: inspection.walkthrough_date,
    scope_inclusions: inspection.scope_inclusions,
    scope_exclusions: inspection.scope_exclusions,
    cleaning_days: inspection.cleaning_days,
    clean_window: inspection.clean_window,
    target_start: inspection.target_start,
    cleanable_sqft: inspection.cleanable_sqft,
    visits_per_week: inspection.visits_per_week,
    sent_at: inspection.sent_at,
    valid_until: inspection.valid_until,
    accepted_at: inspection.accepted_at,
    declined_at: inspection.declined_at,
    expired: isQuoteExpired(inspection, now),
    actionable: isQuoteActionable(inspection, now),
    addons: addons.filter((a) => a.enabled).map((a) => ({ name: a.name, price: a.price })),
    lines: lines.map(toPublicQuoteLine),
    totals,
    pricing: {
      monthly: quote.monthly,
      addonTotal: quote.addonTotal,
      visitsPerMonth: quote.visitsPerMonth,
      perVisit: quote.perVisit != null ? Math.round(quote.perVisit) : null,
      annual: quote.annual,
    },
  };
}
