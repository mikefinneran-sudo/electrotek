// Convert an accepted quote into a draft invoice.
//
// Lives in BILLING, not in the quote engine: billing already owns
// invoices.inspection_id, and the quote engine must stay usable by a client
// whose client.config.ts does not enable billing at all. The app wires this
// into createPublicQuoteRouteHandlers({ onAccepted }).
//
// The inputs are STRUCTURALLY typed (see quote-conversion-pricing.ts) rather
// than imported from the quote-engine package, so this adds no dependency
// between the two modules. The shapes are a subset of Inspection and QuoteAddon.

import "server-only";
import type { AuditActor } from "@waltersignal/bananaforce-data-supabase/audit";
import {
  invoiceNumberFromEstimate,
  resolveAcceptedQuoteMonthly,
  type AcceptedQuote,
  type AcceptedQuoteAddon,
} from "./quote-conversion-pricing";
import { createInvoiceForInspection } from "./server";
import type { Invoice } from "./types";

export {
  invoiceNumberFromEstimate,
  resolveAcceptedQuoteMonthly,
  type AcceptedQuote,
  type AcceptedQuoteAddon,
};

export interface QuoteConversionOptions {
  /**
   * Days from acceptance until the first invoice is due. Defaults to net-14 —
   * deliberately shorter than the 30-day quote validity window, which is about
   * how long the PRICE holds, not about payment terms.
   */
  dueInDays?: number;
  /** Pre-resolved monthly total. Supply it to avoid recomputing here. */
  monthly?: number | null;
  actor?: AuditActor | null;
}

const DEFAULT_DUE_IN_DAYS = 14;

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Draft an invoice for a newly accepted quote.
 *
 * IDEMPOTENT. Returns the existing invoice if one already references this
 * inspection instead of drafting a second. The accept path can plausibly run
 * twice (a retried request, a staff-side accept racing the customer's), and
 * duplicate invoices for one signed agreement is the kind of error a client
 * notices and does not forgive.
 *
 * Created as a DRAFT, never as `open`: a human confirms the first invoice of a
 * new engagement before it reaches the customer.
 */
export async function createInvoiceFromAcceptedQuote(
  quote: AcceptedQuote,
  addons: readonly AcceptedQuoteAddon[] = [],
  options: QuoteConversionOptions = {},
): Promise<Invoice | null> {
  const monthly =
    options.monthly !== undefined ? options.monthly : resolveAcceptedQuoteMonthly(quote, addons);

  return createInvoiceForInspection(
    {
      inspection_id: quote.id,
      number: invoiceNumberFromEstimate(quote.estimate_number),
      amount_due: monthly ?? 0,
      status: "draft",
      due_date: addDays(options.dueInDays ?? DEFAULT_DUE_IN_DAYS),
    },
    options.actor ?? null,
  );
}
