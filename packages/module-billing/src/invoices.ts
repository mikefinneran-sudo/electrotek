// Pure invoice helpers — no DB, no env, fully deterministic. Safe to import
// anywhere (browser or server). The test file exercises all paths.

import { INVOICE_STATUSES, type Invoice, type InvoiceStatus } from "./types";

export interface InvoiceTotals {
  /** Sum of open + draft invoices (amount_due). */
  outstanding: number;
  /** Sum of paid invoices (amount_due). */
  collected: number;
  /** Sum of all invoices regardless of status. */
  total: number;
}

/**
 * Aggregate invoice amounts by status bucket.
 * Treats open and draft as outstanding; paid as collected. Returns zeros on an
 * empty list.
 */
export function invoiceTotals(invoices: readonly Invoice[]): InvoiceTotals {
  let outstanding = 0;
  let collected = 0;
  let total = 0;
  for (const inv of invoices) {
    const amount = inv.amount_due ?? 0;
    total += amount;
    if (inv.status === "open" || inv.status === "draft") {
      outstanding += amount;
    } else if (inv.status === "paid") {
      collected += amount;
    }
  }
  return { outstanding, collected, total };
}

/**
 * Returns true iff the invoice is open/draft AND its due_date has passed.
 * @param nowISO  ISO 8601 date string for "now" (e.g. new Date().toISOString()).
 */
export function isOverdue(invoice: Invoice, nowISO: string): boolean {
  if (invoice.status !== "open" && invoice.status !== "draft") return false;
  if (!invoice.due_date) return false;
  // Compare date strings lexicographically (YYYY-MM-DD). If due_date < today's
  // date prefix the invoice is overdue.
  const today = nowISO.slice(0, 10);
  return invoice.due_date < today;
}

// Legal status transitions. The forward path: draft → open → paid/void/uncollectible.
// Void and uncollectible are terminal. The 'paid' status can be set back to
// 'open' only in an unusual refund scenario — excluded here to keep the guard
// conservative; the route layer can use patchInvoice directly for edge cases.
const VALID_TRANSITIONS: Partial<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ["open", "void"],
  open: ["paid", "void", "uncollectible"],
  // paid, void, uncollectible are terminal — no outbound transitions.
};

/**
 * Guard: return the next status if the transition is legal, or null if not.
 * Keeps business rules out of the route layer — callers validate before calling
 * patchInvoice.
 */
export function nextInvoiceStatus(
  current: InvoiceStatus,
  event: InvoiceStatus,
): InvoiceStatus | null {
  if (!INVOICE_STATUSES.includes(event)) return null;
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed) return null; // terminal status
  return allowed.includes(event) ? event : null;
}

/** Stripe's standard US card rate, passed to the client when a contract says so. */
export const CARD_FEE_PERCENT = 0.029;
export const CARD_FEE_FIXED = 0.3;

/**
 * What a card payment charges for an invoice: amount_due alone, or amount_due
 * plus 2.9% + $0.30 when the fee is passed through. Rounded to cents.
 */
export function cardChargeAmount(amountDue: number, feePassthrough: boolean): number {
  const total = feePassthrough
    ? amountDue + amountDue * CARD_FEE_PERCENT + CARD_FEE_FIXED
    : amountDue;
  return Math.round(total * 100) / 100;
}
