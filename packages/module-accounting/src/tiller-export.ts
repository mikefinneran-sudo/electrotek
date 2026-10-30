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
  // Tiller convention: money out is negative.
  const signedAmount =
    eventType === "payment.refunded" || eventType === "expense.recorded"
      ? -Math.abs(amount)
      : amount;

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

/** Header row for the export tab; matches tillerRowValues column order. */
export const TILLER_EXPORT_HEADERS = [
  "Date",
  "Description",
  "Amount",
  "Category",
  "Source Module",
  "Source Ref",
  "Idempotency Key",
];

/** Accepts a Google Sheets URL or a bare spreadsheet id; null when neither. */
export function parseSheetId(input: string): string | null {
  const trimmed = input.trim();
  const id = trimmed.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? trimmed;
  return /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : null;
}

/** A sheet connected in the UI wins; the env sheet id is the fallback. */
export function pickTillerSheet(
  stored: Record<string, unknown> | null,
  envSheetId: string | undefined,
): { sheetId: string; source: "connected" | "default" } | null {
  const connected = stored?.sheet_id;
  if (typeof connected === "string" && connected) {
    return { sheetId: connected, source: "connected" };
  }
  const fallback = envSheetId?.trim();
  return fallback ? { sheetId: fallback, source: "default" } : null;
}
