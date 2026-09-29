import type { ReceiptFields } from "@waltersignal/bananaforce-ai";
import type {
  ConfirmExpenseInput,
  Expense,
  ExpenseDraftInput,
  ExpenseSubjectType,
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
  return errors;
}
