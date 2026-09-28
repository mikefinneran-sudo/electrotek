import assert from "node:assert/strict";
import {
  buildTillerExportRow,
  categoryForEvent,
  ledgerIdempotencyKey,
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

console.log(`tiller-export tests passed (${passed})`);
