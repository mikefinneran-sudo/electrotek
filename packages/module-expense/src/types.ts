/**
 * Draft is where model-proposed fields land. Only an operator moves a draft to
 * confirmed, and only confirmed expenses reach the accounting ledger.
 */
export type ExpenseStatus = "draft" | "confirmed" | "void";

export const EXPENSE_STATUSES: readonly ExpenseStatus[] = ["draft", "confirmed", "void"];

/**
 * What an expense was incurred for. Deliberately NOT a foreign key: the column
 * is polymorphic across public.customers, public.crm_opportunities and
 * public.cases, so no single FK can express it.
 *
 * 'case' is the attribution a forensic practice actually bills on -- scene
 * travel is a reimbursable cost against a case, not overhead. Mirrors the
 * expenses_subject_type_valid CHECK; keep the two in step.
 */
export type ExpenseSubjectType =
  | "customer"
  | "opportunity"
  | "case"
  | "unattributed";

export interface ExpenseCategory {
  id: string;
  name: string;
  /** Maps to a QuickBooks account when the connector is built. */
  external_account_key: string | null;
  legacy_id: string | null;
  source_system: string | null;
}

export interface Expense {
  id: string;
  status: ExpenseStatus;
  vendor: string | null;
  purchased_on: string | null;
  total: number | null;
  tax: number | null;
  currency: string;
  category_id: string | null;
  subject_type: ExpenseSubjectType | null;
  subject_id: string | null;
  note: string | null;
  /** Per-field model confidence, null for hand-entered expenses. */
  field_confidence: Record<string, number> | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  legacy_id: string | null;
  source_system: string | null;
}

export interface ExpenseReceipt {
  id: string;
  expense_id: string;
  /** Object path inside the private `expense-receipts` bucket. */
  storage_path: string;
  media_type: string;
  extracted_at: string | null;
  extraction_error: string | null;
  created_at: string;
}

export interface ExpenseDraftInput {
  vendor: string | null;
  purchased_on: string | null;
  total: number | null;
  tax: number | null;
  currency: string;
  field_confidence: Record<string, number>;
}

export interface ConfirmExpenseInput {
  id: string;
  vendor: string;
  purchased_on: string;
  total: number;
  tax: number | null;
  currency: string;
  category_id: string | null;
  subject_type: ExpenseSubjectType;
  subject_id: string | null;
  note: string | null;
}
