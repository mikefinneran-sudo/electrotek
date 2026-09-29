import "server-only";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { enqueueLedgerEvent } from "@waltersignal/bananaforce-module-accounting/events";
import { confirmationErrors, newExpenseErrors } from "./lifecycle";
import type {
  ConfirmExpenseInput,
  Expense,
  ExpenseCategory,
  ExpenseDraftInput,
  ExpenseReceipt,
  ExpenseReport,
  NewExpenseInput,
} from "./types";

// Every call goes through the SESSION client, so RLS (0067) decides what the
// caller sees: their own expenses and reports, plus everyone's for an admin.
// The explicit submitted_by filters below narrow an admin's personal views to
// their own spending; they are not the access control.

export interface WriteResult {
  ok: boolean;
  id?: string;
  errors?: string[];
}

export interface Viewer {
  id: string;
  email: string;
  name: string | null;
  /** Approvers (role approver or admin) decide reports and mark them reimbursed. */
  isApprover: boolean;
}

export interface CaseLabel {
  id: string;
  case_number: string;
  title: string | null;
}

type Client = Awaited<ReturnType<typeof getSupabaseServerClient>>;

async function client(): Promise<Client | null> {
  return isSupabaseConfigured() ? getSupabaseServerClient() : null;
}

function failed(message: string): WriteResult {
  return { ok: false, errors: [message] };
}

export async function getViewer(): Promise<Viewer | null> {
  const supabase = await client();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("staff")
    .select("id, email, name, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    email: String(data.email),
    name: data.name == null ? null : String(data.name),
    isApprover: data.role === "admin" || data.role === "approver",
  };
}

// --- reads -------------------------------------------------------------------

/** The viewer's own expenses, newest trip first. Void entries are hidden. */
export async function listMyExpenses(viewerId: string): Promise<Expense[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("submitted_by", viewerId)
    .neq("status", "void")
    .order("purchased_on", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(500);
  return error ? [] : ((data ?? []) as Expense[]);
}

export async function getExpense(id: string): Promise<Expense | null> {
  const supabase = await client();
  if (!supabase) return null;
  const { data, error } = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();
  return error || !data ? null : (data as Expense);
}

export async function listCategories(): Promise<ExpenseCategory[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("expense_categories")
    .select("*")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  return error ? [] : ((data ?? []) as ExpenseCategory[]);
}

/** IRS business mileage rates, oldest first, for the form's price preview. */
export async function listMileageRates(): Promise<{ effective_on: string; rate: number }[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data } = await supabase
    .from("expense_mileage_rates")
    .select("effective_on, rate")
    .order("effective_on");
  return (data ?? []).map((row) => ({ effective_on: String(row.effective_on), rate: Number(row.rate) }));
}

export async function listMyReports(viewerId: string): Promise<ExpenseReport[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("expense_reports")
    .select("*")
    .eq("submitted_by", viewerId)
    .order("created_at", { ascending: false })
    .limit(200);
  return error ? [] : ((data ?? []) as ExpenseReport[]);
}

/** Reports an approver acts on: awaiting a decision, or approved and unpaid. */
export async function listApprovalQueue(): Promise<ExpenseReport[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("expense_reports")
    .select("*")
    .in("status", ["submitted", "approved"])
    .order("submitted_at", { ascending: true })
    .limit(200);
  return error ? [] : ((data ?? []) as ExpenseReport[]);
}

export async function getReport(
  id: string,
): Promise<{ report: ExpenseReport; expenses: Expense[] } | null> {
  const supabase = await client();
  if (!supabase) return null;
  const { data: report } = await supabase
    .from("expense_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!report) return null;
  const { data: expenses } = await supabase
    .from("expenses")
    .select("*")
    .eq("report_id", id)
    .neq("status", "void")
    .order("purchased_on", { ascending: true });
  return { report: report as ExpenseReport, expenses: (expenses ?? []) as Expense[] };
}

/** Line-level amounts for many reports at once, for list totals. */
export async function listReportLines(
  reportIds: string[],
): Promise<Pick<Expense, "report_id" | "status" | "total" | "payment_method">[]> {
  const supabase = await client();
  if (!supabase || reportIds.length === 0) return [];
  const { data } = await supabase
    .from("expenses")
    .select("report_id, status, total, payment_method")
    .in("report_id", reportIds);
  return (data ?? []) as Pick<Expense, "report_id" | "status" | "total" | "payment_method">[];
}

export async function staffNames(ids: string[]): Promise<Map<string, string>> {
  const supabase = await client();
  const names = new Map<string, string>();
  if (!supabase || ids.length === 0) return names;
  const { data } = await supabase.from("staff").select("id, email, name").in("id", ids);
  for (const row of data ?? []) names.set(String(row.id), String(row.name ?? row.email));
  return names;
}

/**
 * Case numbers for case-attributed expenses. Cases belong to module-crm; when
 * that table is absent the query errors and expenses show the raw id instead.
 */
export async function caseLabels(ids: string[]): Promise<Map<string, CaseLabel>> {
  const supabase = await client();
  const labels = new Map<string, CaseLabel>();
  if (!supabase || ids.length === 0) return labels;
  const { data } = await supabase.from("cases").select("id, case_number, title").in("id", ids);
  for (const row of data ?? []) labels.set(String(row.id), row as CaseLabel);
  return labels;
}

export async function getReceiptForExpense(expenseId: string): Promise<ExpenseReceipt | null> {
  const supabase = await client();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("expense_receipts")
    .select("*")
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error || !data ? null : (data as ExpenseReceipt);
}

/** Short-lived signed URL — the bucket is private and must stay that way. */
export async function receiptSignedUrl(storagePath: string): Promise<string | null> {
  const supabase = await client();
  if (!supabase) return null;
  const { data, error } = await supabase.storage
    .from("expense-receipts")
    .createSignedUrl(storagePath, 300);
  return error || !data ? null : data.signedUrl;
}

/** expense id -> signed receipt URL, for every expense that has a receipt. */
export async function receiptUrls(expenseIds: string[]): Promise<Map<string, string>> {
  const supabase = await client();
  const urls = new Map<string, string>();
  if (!supabase || expenseIds.length === 0) return urls;
  const { data: receipts } = await supabase
    .from("expense_receipts")
    .select("expense_id, storage_path")
    .in("expense_id", expenseIds);
  if (!receipts?.length) return urls;
  const { data: signed } = await supabase.storage
    .from("expense-receipts")
    .createSignedUrls(receipts.map((r) => String(r.storage_path)), 300);
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  for (const receipt of receipts) {
    const url = byPath.get(String(receipt.storage_path));
    if (url) urls.set(String(receipt.expense_id), url);
  }
  return urls;
}

// --- expense writes ----------------------------------------------------------

/** Draft plus its receipt row, in one transaction (expense_create_draft, 0067). */
export async function createDraftExpense(
  draft: ExpenseDraftInput,
  receipt: {
    storage_path: string;
    media_type: string;
    /**
     * When extraction actually ran. Null when it was never attempted (OCR not
     * configured for this client). Only the caller knows whether an attempt
     * was made; inferring it from `extraction_error` would make "never
     * attempted" look the same as "ran successfully".
     */
    extracted_at: string | null;
    extraction_error?: string | null;
  },
): Promise<WriteResult> {
  const supabase = await client();
  if (!supabase) return failed("Supabase is not configured.");
  const { data, error } = await supabase.rpc("expense_create_draft", {
    p_draft: draft,
    p_receipt: { ...receipt, extraction_error: receipt.extraction_error ?? null },
  });
  if (error || !data) return failed(error?.message ?? "Could not create draft.");
  return { ok: true, id: String(data) };
}

/** A hand-entered expense or mileage trip. Complete on entry, so no draft step. */
export async function createExpense(input: NewExpenseInput): Promise<WriteResult> {
  const errors = newExpenseErrors(input);
  if (errors.length > 0) return { ok: false, errors };
  const supabase = await client();
  if (!supabase) return failed("Supabase is not configured.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failed("Not authenticated.");

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      status: "confirmed",
      vendor: input.vendor.trim(),
      purchased_on: input.purchased_on,
      // Mileage: the expenses_price_mileage trigger overwrites this with
      // miles x the rate on the trip date.
      total: input.miles === null ? input.total : 0,
      tax: input.miles === null ? input.tax : null,
      currency: input.currency.toLowerCase(),
      category_id: input.category_id,
      subject_type: input.subject_type,
      subject_id: input.subject_type === "unattributed" ? null : input.subject_id,
      note: input.note,
      payment_method: input.payment_method,
      city: input.city,
      miles: input.miles,
      confirmed_at: new Date().toISOString(),
      confirmed_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return failed(error?.message ?? "Could not save the expense.");
  return { ok: true, id: String(data.id) };
}

/**
 * The review gate for a scanned receipt: the owner checks the proposed fields
 * against the image and completes the entry. Reaching the books is a separate
 * step -- an approver's decision on the report (decideReport).
 */
export async function confirmExpense(input: ConfirmExpenseInput): Promise<WriteResult> {
  const errors = confirmationErrors(input);
  if (errors.length > 0) return { ok: false, errors };

  const existing = await getExpense(input.id);
  if (!existing) return failed("Expense not found.");
  if (existing.status !== "draft") return failed(`Expense is already ${existing.status}.`);

  const supabase = await client();
  if (!supabase) return failed("Supabase is not configured.");
  // confirmed_by is audit data: read from the session, never from the caller.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failed("Not authenticated.");

  const { data, error } = await supabase
    .from("expenses")
    .update({
      vendor: input.vendor.trim(),
      purchased_on: input.purchased_on,
      total: input.total,
      tax: input.tax,
      currency: input.currency.toLowerCase(),
      category_id: input.category_id,
      subject_type: input.subject_type,
      subject_id: input.subject_type === "unattributed" ? null : input.subject_id,
      note: input.note,
      payment_method: input.payment_method,
      city: input.city,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("status", "draft") // guard against a concurrent confirm
    .select("id");
  if (error) return failed(error.message);
  if (!data?.length) return failed("This expense can no longer be changed.");
  return { ok: true, id: input.id };
}

/**
 * Void an expense that has not been submitted. RLS refuses the update once the
 * expense sits in a submitted, approved or reimbursed report, so a zero-row
 * result means "locked", not "gone".
 */
export async function voidExpense(id: string): Promise<WriteResult> {
  const supabase = await client();
  if (!supabase) return failed("Supabase is not configured.");
  const { data, error } = await supabase
    .from("expenses")
    .update({ status: "void", report_id: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .neq("status", "void")
    .select("id");
  if (error) return failed(error.message);
  if (!data?.length) return failed("This expense is on a submitted report and cannot be removed.");
  return { ok: true, id };
}

// --- report writes -----------------------------------------------------------

export async function createReport(title: string): Promise<WriteResult> {
  if (!title.trim()) return failed("Give the report a name.");
  const supabase = await client();
  if (!supabase) return failed("Supabase is not configured.");
  const { data, error } = await supabase
    .from("expense_reports")
    .insert({ title: title.trim() })
    .select("id")
    .single();
  if (error || !data) return failed(error?.message ?? "Could not create the report.");
  return { ok: true, id: String(data.id) };
}

/** Move expenses into a report, or out of one when reportId is null. */
export async function assignToReport(
  expenseIds: string[],
  reportId: string | null,
): Promise<WriteResult> {
  if (expenseIds.length === 0) return failed("Select at least one expense.");
  const supabase = await client();
  if (!supabase) return failed("Supabase is not configured.");
  const { data, error } = await supabase
    .from("expenses")
    .update({ report_id: reportId, updated_at: new Date().toISOString() })
    .in("id", expenseIds)
    .select("id");
  if (error) return failed(error.message);
  if ((data?.length ?? 0) < expenseIds.length) {
    return failed("Some expenses could not be moved: they are on a submitted report.");
  }
  return { ok: true, id: reportId ?? undefined };
}

export async function deleteReport(id: string): Promise<WriteResult> {
  const supabase = await client();
  if (!supabase) return failed("Supabase is not configured.");
  const { data, error } = await supabase.from("expense_reports").delete().eq("id", id).select("id");
  if (error) return failed(error.message);
  if (!data?.length) return failed("Only an open report can be deleted.");
  return { ok: true };
}

async function transition(fn: string, args: Record<string, unknown>): Promise<WriteResult> {
  const supabase = await client();
  if (!supabase) return failed("Supabase is not configured.");
  const { error } = await supabase.rpc(fn, args);
  return error ? failed(error.message) : { ok: true };
}

export function submitReport(id: string): Promise<WriteResult> {
  return transition("expense_report_submit", { p_report: id });
}

/**
 * Approve or return a report. Approval is where spending reaches the books:
 * each expense is enqueued once as expense.recorded (the outbox dedupes on
 * source id, so a retried approval cannot double-post).
 */
export async function decideReport(
  id: string,
  approve: boolean,
  note: string | null,
): Promise<WriteResult> {
  const result = await transition("expense_report_decide", {
    p_report: id,
    p_approve: approve,
    p_note: note,
  });
  if (!result.ok || !approve) return result;

  const loaded = await getReport(id);
  for (const expense of loaded?.expenses ?? []) {
    // enqueueLedgerEvent never throws: a degraded accounting connector must
    // not undo an approval the approver already made.
    await enqueueLedgerEvent({
      eventType: "expense.recorded",
      sourceModule: "expense",
      sourceId: expense.id,
      payload: {
        amount: Number(expense.total ?? 0),
        description: `${expense.vendor ?? "Expense"} — ${expense.purchased_on ?? ""}`,
      },
    });
  }
  return { ok: true, id };
}

export function markReimbursed(id: string): Promise<WriteResult> {
  return transition("expense_report_mark_reimbursed", { p_report: id });
}
