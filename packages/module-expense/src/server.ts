import "server-only";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { enqueueLedgerEvent } from "@waltersignal/bananaforce-module-accounting/events";
import { canConfirm, confirmationErrors } from "./lifecycle";
import type {
  ConfirmExpenseInput,
  Expense,
  ExpenseCategory,
  ExpenseDraftInput,
  ExpenseReceipt,
} from "./types";

export interface WriteResult {
  ok: boolean;
  id?: string;
  errors?: string[];
}

export async function listExpenses(): Promise<Expense[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []) as Expense[];
}

export async function getExpense(id: string): Promise<Expense | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as Expense;
}

export async function listCategories(): Promise<ExpenseCategory[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.from("expense_categories").select("*").order("name");
  if (error) return [];
  return (data ?? []) as ExpenseCategory[];
}

/** Insert the draft plus its receipt row. Always status 'draft'. */
export async function createDraftExpense(
  draft: ExpenseDraftInput,
  receipt: {
    storage_path: string;
    media_type: string;
    /**
     * When extraction actually ran. Null when it was never attempted (OCR not
     * configured for this client). The caller decides this, not this
     * function — only the caller knows whether an attempt was made, and
     * inferring it from `extraction_error` collapses "never attempted" into
     * the same row shape as "ran successfully".
     */
    extracted_at: string | null;
    extraction_error?: string | null;
  },
): Promise<WriteResult> {
  if (!isSupabaseConfigured()) return { ok: false, errors: ["Supabase is not configured."] };
  const supabase = await getSupabaseServerClient();

  const { data, error } = await supabase
    .from("expenses")
    .insert({ ...draft, status: "draft" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, errors: [error?.message ?? "Could not create draft."] };

  const { error: receiptError } = await supabase.from("expense_receipts").insert({
    expense_id: data.id,
    storage_path: receipt.storage_path,
    media_type: receipt.media_type,
    extracted_at: receipt.extracted_at,
    extraction_error: receipt.extraction_error ?? null,
  });
  if (receiptError) {
    // Two inserts, no transaction: the expense row is already committed. Leaving
    // it behind would show the operator a draft with no retrievable receipt —
    // indistinguishable from a real expense whose image failed to load. Roll it
    // back best-effort so the failure is clean and retryable. A structural fix
    // (single RPC, both rows or neither) is out of scope here — see the task-8
    // report.
    await supabase.from("expenses").delete().eq("id", data.id);
    return { ok: false, errors: [receiptError.message] };
  }

  return { ok: true, id: data.id };
}

/**
 * The confirmation gate. Validates, re-checks the row is still a draft, then
 * writes. Ledger enqueue is layered on in Task 10 — this function is the only
 * place a draft becomes confirmed.
 */
export async function confirmExpense(input: ConfirmExpenseInput): Promise<WriteResult> {
  const errors = confirmationErrors(input);
  if (errors.length > 0) return { ok: false, errors };
  if (!isSupabaseConfigured()) return { ok: false, errors: ["Supabase is not configured."] };

  const existing = await getExpense(input.id);
  if (!existing) return { ok: false, errors: ["Expense not found."] };
  if (existing.status !== "draft") {
    return { ok: false, errors: [`Expense is already ${existing.status}.`] };
  }

  const supabase = await getSupabaseServerClient();

  // confirmed_by is audit data: who approved an expense that reaches the
  // client's books. Read it from the authenticated session, never from the
  // caller — a caller-supplied id can name anyone.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, errors: ["Not authenticated."] };

  const { error } = await supabase
    .from("expenses")
    .update({
      vendor: input.vendor.trim(),
      purchased_on: input.purchased_on,
      total: input.total,
      tax: input.tax,
      currency: input.currency.toLowerCase(),
      category_id: input.category_id,
      subject_type: input.subject_type,
      subject_id: input.subject_id,
      note: input.note,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("status", "draft"); // guard against a concurrent confirm
  if (error) return { ok: false, errors: [error.message] };

  // Confirmation is the only path to the ledger. enqueueLedgerEvent never
  // throws — a degraded accounting connector must not fail the confirmation the
  // operator just performed.
  await enqueueLedgerEvent({
    eventType: "expense.recorded",
    sourceModule: "expense",
    sourceId: input.id,
    payload: {
      amount: input.total,
      description: `${input.vendor.trim()} — ${input.purchased_on}`,
    },
  });

  return { ok: true, id: input.id };
}

export async function voidExpense(id: string): Promise<WriteResult> {
  if (!isSupabaseConfigured()) return { ok: false, errors: ["Supabase is not configured."] };

  const existing = await getExpense(id);
  if (!existing) return { ok: false, errors: ["Expense not found."] };
  if (existing.status !== "draft") {
    // A confirmed expense has already been enqueued to the ledger. Voiding it
    // here would leave the books saying it exists and this system saying it
    // does not, with no error anywhere. Reversing a confirmed expense needs a
    // reversal ledger event, which is deliberately out of scope for this plan.
    return {
      ok: false,
      errors: [`Only a draft can be voided; this expense is ${existing.status}.`],
    };
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("expenses")
    .update({ status: "void", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft"); // concurrency guard, same as confirmExpense
  return error ? { ok: false, errors: [error.message] } : { ok: true, id };
}

export async function getReceiptForExpense(
  expenseId: string,
): Promise<ExpenseReceipt | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("expense_receipts")
    .select("*")
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as ExpenseReceipt;
}

/** Short-lived signed URL — the bucket is private and must stay that way. */
export async function receiptSignedUrl(storagePath: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("expense-receipts")
    .createSignedUrl(storagePath, 300);
  return error || !data ? null : data.signedUrl;
}

export { canConfirm };
