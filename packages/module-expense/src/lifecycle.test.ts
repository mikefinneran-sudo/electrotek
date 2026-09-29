import assert from "node:assert/strict";
import {
  LOW_CONFIDENCE_THRESHOLD,
  canConfirm,
  confirmationErrors,
  draftFromReceiptFields,
  lowConfidenceFields,
  newExpenseErrors,
  reportTotals,
} from "./lifecycle";
import type { ConfirmExpenseInput, Expense } from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "e1",
    status: "draft",
    vendor: "Home Depot",
    purchased_on: "2026-08-02",
    total: 142.87,
    tax: 9.12,
    currency: "usd",
    category_id: null,
    subject_type: null,
    subject_id: null,
    note: null,
    field_confidence: null,
    confirmed_at: null,
    confirmed_by: null,
    created_at: "2026-08-02T10:00:00.000Z",
    updated_at: "2026-08-02T10:00:00.000Z",
    submitted_by: "u1",
    report_id: null,
    payment_method: "personal",
    city: null,
    miles: null,
    mileage_rate: null,
    legacy_id: null,
    source_system: null,
    ...overrides,
  };
}

// --- draft prefill from model proposals ---------------------------------------

const draft = draftFromReceiptFields({
  vendor: { value: "Home Depot", confidence: 0.97 },
  purchasedOn: { value: "2026-08-02", confidence: 0.91 },
  total: { value: 142.87, confidence: 0.95 },
  tax: { value: 9.12, confidence: 0.41 },
  currency: { value: "USD", confidence: 0.99 },
});

check(draft.vendor === "Home Depot", "vendor prefills");
check(draft.total === 142.87, "total prefills");
check(draft.currency === "usd", "currency is lowercased to match the column default");
check(draft.field_confidence.tax === 0.41, "confidence is recorded per field");

// --- a null proposal must not become a zero -----------------------------------

const sparse = draftFromReceiptFields({
  vendor: { value: null, confidence: 0 },
  purchasedOn: { value: null, confidence: 0 },
  total: { value: null, confidence: 0 },
  tax: { value: null, confidence: 0 },
  currency: { value: null, confidence: 0 },
});
check(sparse.total === null, "null total stays null, never 0");
check(sparse.currency === "usd", "currency falls back to the default");

// --- low-confidence flagging --------------------------------------------------

const flagged = lowConfidenceFields(
  makeExpense({ field_confidence: { vendor: 0.97, total: 0.95, tax: 0.41 } }),
);
check(flagged.includes("tax"), "below-threshold field is flagged");
check(!flagged.includes("vendor"), "high-confidence field is not flagged");
check(LOW_CONFIDENCE_THRESHOLD > 0 && LOW_CONFIDENCE_THRESHOLD < 1, "threshold is a ratio");

check(
  lowConfidenceFields(makeExpense({ field_confidence: null })).length === 0,
  "hand-entered expense flags nothing",
);

// --- confirmation gating ------------------------------------------------------

check(canConfirm(makeExpense()) === true, "a complete draft can be confirmed");
check(
  canConfirm(makeExpense({ total: null })) === false,
  "a draft missing its total cannot be confirmed",
);
check(
  canConfirm(makeExpense({ status: "confirmed" })) === false,
  "an already-confirmed expense cannot be re-confirmed",
);
check(
  canConfirm(makeExpense({ status: "void" })) === false,
  "a void expense cannot be confirmed",
);

// --- confirmation input validation --------------------------------------------

check(
  confirmationErrors({
    id: "e1",
    vendor: "",
    purchased_on: "2026-08-02",
    total: 10,
    tax: null,
    currency: "usd",
    category_id: null,
    subject_type: "unattributed",
    subject_id: null,
    note: null,
    payment_method: "personal",
    city: null,
  }).includes("vendor is required"),
  "blank vendor is rejected",
);

check(
  confirmationErrors({
    id: "e1",
    vendor: "Acme",
    purchased_on: "08/02/2026",
    total: 10,
    tax: null,
    currency: "usd",
    category_id: null,
    subject_type: "unattributed",
    subject_id: null,
    note: null,
    payment_method: "personal",
    city: null,
  }).includes("purchased_on must be ISO yyyy-mm-dd"),
  "non-ISO date is rejected",
);

check(
  confirmationErrors({
    id: "e1",
    vendor: "Acme",
    purchased_on: "2026-08-02",
    total: -1,
    tax: null,
    currency: "usd",
    category_id: null,
    subject_type: "unattributed",
    subject_id: null,
    note: null,
    payment_method: "personal",
    city: null,
  }).includes("total must be zero or greater"),
  "negative total is rejected",
);

check(
  confirmationErrors({
    id: "e1",
    vendor: "Acme",
    purchased_on: "2026-08-02",
    total: 10,
    tax: null,
    currency: "usd",
    category_id: null,
    subject_type: "customer",
    subject_id: null,
    note: null,
    payment_method: "personal",
    city: null,
  }).includes("subject_id is required when subject_type is not unattributed"),
  "attributed expense needs a subject id",
);

check(
  confirmationErrors({
    id: "e1",
    vendor: "Acme",
    purchased_on: "2026-08-02",
    total: 10,
    tax: 1,
    currency: "usd",
    category_id: null,
    subject_type: "unattributed",
    subject_id: null,
    note: null,
    payment_method: "personal",
    city: null,
  }).length === 0,
  "a valid confirmation has no errors",
);

check(
  confirmationErrors({
    id: "e1",
    vendor: "Acme",
    purchased_on: "2026-08-02",
    total: 10,
    tax: null,
    currency: "usd",
    category_id: null,
    // Cast simulates an invalid value reaching validation from an untyped
    // source (e.g. form data), same as the DB CHECK constraint guards against.
    subject_type: "vendor" as ConfirmExpenseInput["subject_type"],
    subject_id: null,
    note: null,
    payment_method: "personal",
    city: null,
  }).includes("subject_type must be customer, opportunity, case, or unattributed"),
  "invalid subject_type is rejected before it reaches the DB check constraint",
);

// --- hand entry and mileage ---------------------------------------------------

const manual = {
  vendor: "Hampton Inn",
  purchased_on: "2026-08-03",
  total: 142.5,
  tax: null,
  currency: "usd",
  category_id: null,
  subject_type: "unattributed" as const,
  subject_id: null,
  note: null,
  payment_method: "personal" as const,
  city: "Gray, IN",
  miles: null,
};
check(newExpenseErrors(manual).length === 0, "a complete hand-entered expense is valid");
check(
  newExpenseErrors({ ...manual, vendor: "", miles: 42 }).includes("route is required"),
  "mileage names its missing field as the route, not the vendor",
);
check(
  newExpenseErrors({ ...manual, miles: 0 }).includes("miles must be greater than zero"),
  "zero miles is rejected",
);
check(
  newExpenseErrors({ ...manual, total: Number.NaN, miles: 42 }).length === 0,
  "mileage does not require a typed total; the database prices it",
);
check(
  newExpenseErrors({ ...manual, payment_method: "cash" as never }).includes(
    "payment_method must be personal or company_card",
  ),
  "unknown payment method is rejected",
);

// --- report totals ------------------------------------------------------------

const totals = reportTotals([
  { status: "confirmed", total: 0.1, payment_method: "personal" },
  { status: "confirmed", total: 0.2, payment_method: "personal" },
  { status: "confirmed", total: 300, payment_method: "company_card" },
  { status: "void", total: 999, payment_method: "personal" },
]);
check(totals.count === 3, "void expenses are not counted");
check(totals.total === 300.3, "report total sums in cents");
check(totals.reimbursable === 0.3, "only personal spending is reimbursable");

console.log(`lifecycle.test.ts: ${passed} assertions passed`);
