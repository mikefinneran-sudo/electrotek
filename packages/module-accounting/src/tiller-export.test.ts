import assert from "node:assert/strict";
import {
  buildTillerExportRow,
  categoryForEvent,
  ledgerIdempotencyKey,
  parseSheetId,
  pickTillerSheet,
  TILLER_EXPORT_HEADERS,
  tillerRowValues,
} from "./tiller-export";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

check(
  ledgerIdempotencyKey("payment.succeeded", "billing", "pay-1") ===
    "billing:payment.succeeded:pay-1",
  "idempotency key format",
);

check(
  categoryForEvent("payment.succeeded") === "revenue.payment",
  "payment category",
);

const row = buildTillerExportRow(
  "payment.succeeded",
  "billing",
  "pay-1",
  { amount: 120.5, invoice_number: "INV-100" },
);

check(row.amount === 120.5, "export row amount");
check(row.description.includes("INV-100"), "export row description uses invoice number");
check(row.idempotencyKey.includes("pay-1"), "export row idempotency");

const values = tillerRowValues(row);
check(values.length === 7, "export row has 7 columns");
check(values[0] === row.date, "first column is date");

const refund = buildTillerExportRow(
  "payment.refunded",
  "billing",
  "pay-2",
  { amount: 50 },
);
check(refund.amount === -50, "refund amount is negative");

const expense = buildTillerExportRow(
  "expense.recorded",
  "expense",
  "exp-1",
  { amount: 42.5, description: "Vendor — 2026-10-15" },
);
check(expense.amount === -42.5, "expense amount is negative");

const sheetUrl =
  "https://docs.google.com/spreadsheets/d/1USgPUIPuLKCL2ESky3Fylg_3y4lH1Jmjfl22Z-p5Mvc/edit#gid=0";
check(parseSheetId(sheetUrl) === "1USgPUIPuLKCL2ESky3Fylg_3y4lH1Jmjfl22Z-p5Mvc", "sheet id parsed from URL");
check(parseSheetId(" 1USgPUIPuLKCL2ESky3Fylg_3y4lH1Jmjfl22Z-p5Mvc ") === "1USgPUIPuLKCL2ESky3Fylg_3y4lH1Jmjfl22Z-p5Mvc", "bare sheet id accepted");
check(parseSheetId("not a sheet") === null, "garbage rejected");
check(parseSheetId("https://example.com/../x") === null, "non-sheet URL rejected");
check(TILLER_EXPORT_HEADERS.length === values.length, "headers match row width");
check(pickTillerSheet({ sheet_id: "db-sheet" }, "env-sheet")?.source === "connected", "connected sheet wins");
check(pickTillerSheet(null, "env-sheet")?.sheetId === "env-sheet", "env sheet is fallback");
check(pickTillerSheet({}, " ") === null, "nothing configured");

console.log(`tiller-export tests passed (${passed})`);
