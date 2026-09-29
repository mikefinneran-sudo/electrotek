import { uploadReceiptAndDraft } from "./actions";
import {
  confirmExpense,
  getReceiptForExpense,
  listCategories,
  listExpenses,
  receiptSignedUrl,
} from "./server";
import { DraftReviewForm, ExpenseList, ReceiptUpload } from "./ui";
import type { ClientConfig } from "@waltersignal/bananaforce-core";
import type { ExpenseSubjectType } from "./types";

/**
 * Factory for the /expenses page, matching the repo's `createXPage(clientConfig)`
 * convention (see module-asset-controls). App Router page components don't
 * receive arbitrary props, so `aiConfig` comes from the client's own config
 * rather than a caller-supplied prop.
 */
export function createExpensesPage(clientConfig: ClientConfig) {
  return async function ExpensesPage() {
    const aiConfig = clientConfig.ai;
    const [expenses, categories] = await Promise.all([listExpenses(), listCategories()]);
    // Oldest-first so the queue drains: an operator who photographs a stack of
    // receipts gets them back in the order they shot them, and no draft can be
    // stranded behind a newer one. listExpenses() returns created_at desc.
    const drafts = expenses.filter((expense) => expense.status === "draft");
    const draft = drafts.length > 0 ? drafts[drafts.length - 1] : null;

    // Resolve the draft's receipt so the operator can check flagged fields
    // against the actual document rather than trusting the proposals.
    const receipt = draft ? await getReceiptForExpense(draft.id) : null;
    const receiptUrl = receipt ? await receiptSignedUrl(receipt.storage_path) : null;

    async function handleUpload(formData: FormData) {
      "use server";
      const file = formData.get("receipt");
      if (!(file instanceof File)) {
        return { ok: false, errors: ["No file was submitted."] };
      }
      return uploadReceiptAndDraft(file, aiConfig);
    }

    async function handleConfirm(formData: FormData) {
      "use server";
      const tax = formData.get("tax");
      const subjectId = formData.get("subject_id");
      const categoryId = formData.get("category_id");
      const note = formData.get("note");

      return confirmExpense({
        id: String(formData.get("id")),
        vendor: String(formData.get("vendor") ?? ""),
        purchased_on: String(formData.get("purchased_on") ?? ""),
        total: Number(formData.get("total")),
        tax: tax === null || tax === "" ? null : Number(tax),
        currency: String(formData.get("currency") ?? "usd"),
        category_id: categoryId ? String(categoryId) : null,
        subject_type: String(formData.get("subject_type") ?? "unattributed") as ExpenseSubjectType,
        subject_id: subjectId ? String(subjectId) : null,
        note: note ? String(note) : null,
      });
    }

    return (
      <main>
        <h1>Expenses</h1>
        <ReceiptUpload onUpload={handleUpload} />
        {draft ? (
          <DraftReviewForm
            expense={draft}
            categories={categories}
            receiptUrl={receiptUrl}
            pendingCount={drafts.length}
            onConfirm={handleConfirm}
          />
        ) : null}
        <ExpenseList expenses={expenses} />
      </main>
    );
  };
}
