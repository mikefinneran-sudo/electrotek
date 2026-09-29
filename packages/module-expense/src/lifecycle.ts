import type { ReceiptFields } from "@waltersignal/bananaforce-ai";
import type {
  ConfirmExpenseInput,
  Expense,
  ExpenseDraftInput,
  ExpenseSubjectType,
  NewExpenseInput,
  PaymentMethod,
} from "./types";

/** Below this, the UI flags the field for the operator rather than trusting it. */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Mirrors the `expenses_subject_type_valid` CHECK constraint. */
const VALID_SUBJECT_TYPES: readonly ExpenseSubjectType[] = [
  "customer",
  "opportunity",
  "case",
  "unattributed",
];

/** Mirrors the `expenses_payment_method_valid` CHECK constraint. */
const VALID_PAYMENT_METHODS: readonly PaymentMethod[] = ["personal", "company_card"];

/**
 * Turn model proposals into a draft row. A null proposal stays null — the
 * operator types it. Nothing here is authoritative until confirmation.
 */
export function draftFromReceiptFields(fields: ReceiptFields): ExpenseDraftInput {
  return {
    vendor: fields.vendor.value,
    purchased_on: fields.purchasedOn.value,
    total: fields.total.value,
    tax: fields.tax.value,
    currency: (fields.currency.value ?? "usd").toLowerCase(),
    field_confidence: {
      vendor: fields.vendor.confidence,
      purchased_on: fields.purchasedOn.confidence,
      total: fields.total.confidence,
      tax: fields.tax.confidence,
      currency: fields.currency.confidence,
    },
  };
}

/** Field names the operator should look at before confirming. */
export function lowConfidenceFields(expense: Expense): string[] {
  if (!expense.field_confidence) return [];
  return Object.entries(expense.field_confidence)
    .filter(([, confidence]) => confidence < LOW_CONFIDENCE_THRESHOLD)
    .map(([field]) => field);
}

/** Only a complete draft may be confirmed — mirrors the DB check constraint. */
export function canConfirm(expense: Expense): boolean {
  return (
    expense.status === "draft" &&
    Boolean(expense.vendor) &&
    Boolean(expense.purchased_on) &&
    expense.total !== null
  );
}

export function confirmationErrors(input: ConfirmExpenseInput): string[] {
  const errors: string[] = [];
  if (!input.vendor.trim()) errors.push("vendor is required");
  if (!ISO_DATE.test(input.purchased_on)) errors.push("purchased_on must be ISO yyyy-mm-dd");
  if (!Number.isFinite(input.total) || input.total < 0) {
    errors.push("total must be zero or greater");
  }
  if (input.tax !== null && (!Number.isFinite(input.tax) || input.tax < 0)) {
    errors.push("tax must be zero or greater");
  }
  if (!input.currency.trim()) errors.push("currency is required");
  if (!VALID_SUBJECT_TYPES.includes(input.subject_type)) {
    errors.push("subject_type must be customer, opportunity, case, or unattributed");
  }
  if (input.subject_type !== "unattributed" && !input.subject_id) {
    errors.push("subject_id is required when subject_type is not unattributed");
  }
  if (!VALID_PAYMENT_METHODS.includes(input.payment_method)) {
    errors.push("payment_method must be personal or company_card");
  }
  return errors;
}

/**
 * Validation for a hand-entered expense or a mileage trip. Mileage is priced by
 * the database, so its total is not checked here -- miles are.
 */
export function newExpenseErrors(input: NewExpenseInput): string[] {
  const mileage = input.miles !== null;
  const errors = confirmationErrors({
    ...input,
    id: "new",
    total: mileage ? 0 : input.total,
  }).map((error) => (mileage && error === "vendor is required" ? "route is required" : error));
  if (mileage && (!Number.isFinite(input.miles) || (input.miles ?? 0) <= 0)) {
    errors.push("miles must be greater than zero");
  }
  return errors;
}

/**
 * What a report adds up to. Reimbursable is what the firm owes the employee:
 * personal-card spending only. Void expenses count toward neither.
 */
export function reportTotals(expenses: readonly Pick<Expense, "status" | "total" | "payment_method">[]) {
  let total = 0;
  let reimbursable = 0;
  let count = 0;
  for (const expense of expenses) {
    if (expense.status === "void") continue;
    const amount = Number(expense.total ?? 0);
    total += amount;
    if (expense.payment_method === "personal") reimbursable += amount;
    count += 1;
  }
  // Cents, not float drift: 0.1 + 0.2 must read as 0.30 on a reimbursement.
  return { count, total: Math.round(total * 100) / 100, reimbursable: Math.round(reimbursable * 100) / 100 };
}
