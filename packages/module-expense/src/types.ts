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

export type PaymentMethod = "personal" | "company_card";

/** Who pays whom: a personal card is reimbursed to the employee, a company card is not. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  personal: "Personal card / cash",
  company_card: "Company card",
};

/** Column-width labels for tables. */
export const PAYMENT_METHOD_SHORT: Record<PaymentMethod, string> = {
  personal: "Personal",
  company_card: "Company card",
};

export type ExpenseReportStatus = "open" | "submitted" | "approved" | "rejected" | "reimbursed";

export const REPORT_STATUS_LABELS: Record<ExpenseReportStatus, string> = {
  open: "Open",
  submitted: "Awaiting approval",
  approved: "Approved",
  rejected: "Returned",
  reimbursed: "Reimbursed",
};

export interface ExpenseReport {
  id: string;
  title: string;
  submitted_by: string;
  status: ExpenseReportStatus;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  reimbursed_at: string | null;
  reimbursed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
  /** Entered as miles and priced by the database at the IRS rate on the trip date. */
  per_mile: boolean;
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
  updated_at: string;
  /** The staff member who incurred it. Set by the database from the session. */
  submitted_by: string;
  report_id: string | null;
  payment_method: PaymentMethod;
  city: string | null;
  /** Mileage entries only. The database sets mileage_rate and total from these. */
  miles: number | null;
  mileage_rate: number | null;
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
  payment_method: PaymentMethod;
  city: string | null;
}

/** A hand-entered expense, or a mileage trip when `miles` is set. */
export interface NewExpenseInput {
  vendor: string;
  purchased_on: string;
  /** Ignored for mileage: the database prices miles x rate. */
  total: number;
  tax: number | null;
  currency: string;
  category_id: string | null;
  subject_type: ExpenseSubjectType;
  subject_id: string | null;
  note: string | null;
  payment_method: PaymentMethod;
  city: string | null;
  miles: number | null;
}
