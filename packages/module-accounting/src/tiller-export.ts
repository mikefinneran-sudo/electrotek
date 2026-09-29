// Pure helpers for building Tiller export rows and event idempotency keys.
// No I/O — safe for unit tests.

import type { LedgerEventPayload, LedgerEventType, TillerExportRow } from "./types";

const MAX_DESCRIPTION = 500;

export function ledgerIdempotencyKey(
  eventType: LedgerEventType,
  sourceModule: string,
  sourceId: string,
): string {
  return `${sourceModule}:${eventType}:${sourceId}`.slice(0, 256);
}

export function categoryForEvent(eventType: LedgerEventType): string {
  switch (eventType) {
    case "payment.succeeded":
      return "revenue.payment";
    case "payment.refunded":
      return "revenue.refund";
    case "invoice.opened":
      return "accounts_receivable";
    case "order.submitted":
      return "revenue.order";
    case "expense.recorded":
      return "expense.purchase";
    default: {
      const exhaustive: never = eventType;
      throw new Error(`Unhandled ledger event type: ${exhaustive}`);
    }
  }
}

export function buildTillerExportRow(
  eventType: LedgerEventType,
  sourceModule: string,
  sourceId: string,
  payload: LedgerEventPayload,
  categoryOverride?: string,
): TillerExportRow {
  const amount = payload.amount ?? 0;
  const signedAmount =
    eventType === "payment.refunded" ? -Math.abs(amount) : amount;

  const description =
    payload.description ??
    (payload.invoice_number
      ? `${eventType} — ${payload.invoice_number}`
      : `${eventType} — ${sourceModule}:${sourceId}`);

  return {
    date: new Date().toISOString().slice(0, 10),
    description: description.slice(0, MAX_DESCRIPTION),
    amount: signedAmount,
    category: categoryOverride ?? categoryForEvent(eventType),
    sourceModule,
    sourceRef: sourceId,
    idempotencyKey: ledgerIdempotencyKey(eventType, sourceModule, sourceId),
  };
}

/** Sheet row values in column order for append. */
export function tillerRowValues(row: TillerExportRow): string[] {
  return [
    row.date,
    row.description,
    String(row.amount),
    row.category,
    row.sourceModule,
    row.sourceRef,
    row.idempotencyKey,
  ];
}
