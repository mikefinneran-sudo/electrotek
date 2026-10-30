import assert from "node:assert/strict";
import { cardChargeAmount, invoiceTotals, isOverdue, nextInvoiceStatus } from "./invoices";
import type { Invoice } from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// --- helpers ----------------------------------------------------------------

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: crypto.randomUUID(),
    inspection_id: null,
    customer_id: null,
    contract_id: null,
    card_fee_passthrough: false,
    number: "INV-001",
    amount_due: 0,
    currency: "usd",
    status: "draft",
    stripe_invoice_id: null,
    processor: null,
    line_items: null,
    mercury_invoice_id: null,
    mercury_invoice_slug: null,
    due_date: null,
    paid_at: null,
    ...overrides,
  };
}

// --- invoiceTotals: empty list -----------------------------------------------

const emptyTotals = invoiceTotals([]);
check(emptyTotals.outstanding === 0, "empty list: outstanding is 0");
check(emptyTotals.collected === 0, "empty list: collected is 0");
check(emptyTotals.total === 0, "empty list: total is 0");

// --- invoiceTotals: outstanding = open + draft -----------------------------

const mixedInvoices: Invoice[] = [
  makeInvoice({ status: "draft", amount_due: 100 }),
  makeInvoice({ status: "open", amount_due: 200 }),
  makeInvoice({ status: "paid", amount_due: 50 }),
  makeInvoice({ status: "void", amount_due: 75 }),
  makeInvoice({ status: "uncollectible", amount_due: 30 }),
];
const mixed = invoiceTotals(mixedInvoices);
check(mixed.outstanding === 300, "outstanding = draft(100) + open(200)");
check(mixed.collected === 50, "collected = paid(50)");
check(mixed.total === 455, "total = all amounts summed");

// --- invoiceTotals: all paid ------------------------------------------------

const allPaid = invoiceTotals([
  makeInvoice({ status: "paid", amount_due: 500 }),
  makeInvoice({ status: "paid", amount_due: 250 }),
]);
check(allPaid.outstanding === 0, "all paid: outstanding is 0");
check(allPaid.collected === 750, "all paid: collected is 750");

// --- isOverdue: false when no due_date ------------------------------------

const noDueDate = makeInvoice({ status: "open", due_date: null });
check(!isOverdue(noDueDate, "2025-06-19T00:00:00Z"), "no due_date: not overdue");

// --- isOverdue: false when status is paid/void/uncollectible --------------

const paidInvoice = makeInvoice({ status: "paid", due_date: "2020-01-01" });
check(!isOverdue(paidInvoice, "2025-06-19T00:00:00Z"), "paid invoice: not overdue regardless of date");

const voidInvoice = makeInvoice({ status: "void", due_date: "2020-01-01" });
check(!isOverdue(voidInvoice, "2025-06-19T00:00:00Z"), "void invoice: not overdue");

// --- isOverdue: true when open + past due ---------------------------------

const overdueInvoice = makeInvoice({ status: "open", due_date: "2024-01-01" });
check(isOverdue(overdueInvoice, "2025-06-19T00:00:00Z"), "open invoice past due_date: overdue");

// --- isOverdue: false when due in the future ------------------------------

const futureInvoice = makeInvoice({ status: "open", due_date: "2099-12-31" });
check(!isOverdue(futureInvoice, "2025-06-19T00:00:00Z"), "open invoice future due_date: not overdue");

// --- isOverdue: true when draft + past due --------------------------------

const overdraftInvoice = makeInvoice({ status: "draft", due_date: "2023-05-01" });
check(isOverdue(overdraftInvoice, "2025-06-19T00:00:00Z"), "draft invoice past due_date: overdue");

// --- nextInvoiceStatus: legal transitions ---------------------------------

check(nextInvoiceStatus("draft", "open") === "open", "draft → open is legal");
check(nextInvoiceStatus("draft", "void") === "void", "draft → void is legal");
check(nextInvoiceStatus("open", "paid") === "paid", "open → paid is legal");
check(nextInvoiceStatus("open", "void") === "void", "open → void is legal");
check(nextInvoiceStatus("open", "uncollectible") === "uncollectible", "open → uncollectible is legal");

// --- nextInvoiceStatus: illegal transitions (terminal statuses) -----------

check(nextInvoiceStatus("paid", "open") === null, "paid → open is illegal (terminal)");
check(nextInvoiceStatus("paid", "void") === null, "paid → void is illegal (terminal)");
check(nextInvoiceStatus("void", "open") === null, "void → open is illegal (terminal)");
check(nextInvoiceStatus("uncollectible", "open") === null, "uncollectible → open is illegal (terminal)");

// --- nextInvoiceStatus: skipping steps ------------------------------------

check(nextInvoiceStatus("draft", "paid") === null, "draft → paid is illegal (skip)");
check(nextInvoiceStatus("draft", "uncollectible") === null, "draft → uncollectible is illegal (skip)");

// --- cardChargeAmount ---------------------------------------------------------

check(cardChargeAmount(1250, true) === 1286.55, "1250 with fee passthrough → 1286.55 (2.9% + $0.30)");
check(cardChargeAmount(750, false) === 750, "750 without passthrough → 750");
check(cardChargeAmount(100.1, true) === 103.3, "rounds to cents");

console.log(`invoices tests passed (${passed})`);
