import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { uploadReceiptAndDraft } from "./actions";
import { reportTotals } from "./lifecycle";
import {
  assignToReport,
  caseLabels,
  confirmExpense,
  createExpense,
  createReport,
  decideReport,
  deleteReport,
  getExpense,
  getReceiptForExpense,
  getReport,
  getViewer,
  listApprovalQueue,
  listCategories,
  listMileageRates,
  listMyExpenses,
  listMyReports,
  listReportLines,
  markReimbursed,
  receiptSignedUrl,
  receiptUrls,
  staffNames,
  submitReport,
  voidExpense,
} from "./server";
import type { Expense, ExpenseReport, ExpenseSubjectType, PaymentMethod } from "./types";
import { DraftReviewForm, NewExpenseForm, ReceiptUpload } from "./ui";
import {
  ExpenseTabs,
  type ExpenseView,
  Notice,
  ReportDetail,
  type ReportRow,
  ReportTable,
  ReturnedReports,
  SummaryStrip,
  UnreportedPanel,
} from "./views";

type SearchParams = Record<string, string | string[] | undefined>;

const PATH = "/expenses";

/** Back to a view with a one-line message. redirect() throws; call it last. */
function go(query: Record<string, string | null | undefined>): never {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  revalidatePath(PATH);
  redirect(`${PATH}?${params.toString()}`);
}

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function billing(formData: FormData): { subject_type: ExpenseSubjectType; subject_id: string | null } {
  const subjectType = text(formData, "subject_type") === "case" ? "case" : "unattributed";
  return { subject_type: subjectType, subject_id: subjectType === "case" ? text(formData, "subject_id") : null };
}

function rowsFor(
  reports: ExpenseReport[],
  lines: Awaited<ReturnType<typeof listReportLines>>,
  names?: Map<string, string>,
): ReportRow[] {
  return reports.map((report) => ({
    report,
    ...reportTotals(lines.filter((line) => line.report_id === report.id)),
    submitter: names?.get(report.submitted_by),
  }));
}

function sum(rows: ReportRow[], key: "total" | "reimbursable"): number {
  return Math.round(rows.reduce((acc, row) => acc + row[key], 0) * 100) / 100;
}

/**
 * Factory for the /expenses page, matching the repo's `createXPage(clientConfig)`
 * convention. `aiConfig` comes from the client's own config, since App Router
 * pages do not receive arbitrary props.
 */
export function createExpensesPage(clientConfig: ClientConfig) {
  return async function ExpensesPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
    const params = (await searchParams) ?? {};
    const param = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : null);
    const aiConfig = clientConfig.ai;

    const viewer = await getViewer();
    if (!viewer) {
      return (
        <main className="container expense-page">
          <header className="page-head">
            <span className="eyebrow">Expenses</span>
            <h1>Expenses</h1>
          </header>
          <p className="callout">Sign in with your staff account to record expenses.</p>
        </main>
      );
    }

    const requested = param("view");
    const view: ExpenseView =
      requested === "reports" ? "reports" : requested === "approvals" && viewer.isApprover ? "approvals" : "mine";
    const reportId = param("report");
    const add = param("add");

    // --- actions ---------------------------------------------------------

    async function handleUpload(formData: FormData) {
      "use server";
      const file = formData.get("receipt");
      if (!(file instanceof File)) return { ok: false, errors: ["No file was submitted."] };
      const result = await uploadReceiptAndDraft(file, aiConfig);
      revalidatePath(PATH);
      return result;
    }

    async function handleConfirm(formData: FormData) {
      "use server";
      const tax = text(formData, "tax");
      const result = await confirmExpense({
        id: String(formData.get("id")),
        vendor: text(formData, "vendor") ?? "",
        purchased_on: text(formData, "purchased_on") ?? "",
        total: Number(formData.get("total")),
        tax: tax === null ? null : Number(tax),
        currency: text(formData, "currency") ?? "usd",
        category_id: text(formData, "category_id"),
        ...billing(formData),
        note: text(formData, "note"),
        payment_method: (text(formData, "payment_method") ?? "personal") as PaymentMethod,
        city: text(formData, "city"),
      });
      if (!result.ok) return result;
      go({ notice: "Expense saved." });
    }

    async function handleCreate(formData: FormData) {
      "use server";
      const mileage = formData.get("mileage") === "1";
      const tax = text(formData, "tax");
      const result = await createExpense({
        vendor: text(formData, "vendor") ?? "",
        purchased_on: text(formData, "purchased_on") ?? "",
        total: mileage ? 0 : Number(formData.get("total")),
        tax: mileage || tax === null ? null : Number(tax),
        currency: "usd",
        category_id: text(formData, "category_id"),
        ...billing(formData),
        note: text(formData, "note"),
        payment_method: (text(formData, "payment_method") ?? "personal") as PaymentMethod,
        city: text(formData, "city"),
        miles: mileage ? Number(formData.get("miles")) : null,
      });
      if (!result.ok) return result;
      go({ notice: mileage ? "Trip logged." : "Expense saved." });
    }

    async function handleDelete(formData: FormData) {
      "use server";
      const result = await voidExpense(String(formData.get("id")));
      go(result.ok ? { notice: "Expense deleted." } : { error: result.errors?.[0] });
    }

    async function handleAssign(formData: FormData) {
      "use server";
      const ids = formData.getAll("expense_id").map(String);
      if (ids.length === 0) go({ error: "Tick the expenses to put on the report first." });
      let target = text(formData, "report_id");
      if (!target || target === "new") {
        const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
        const created = await createReport(text(formData, "title") ?? `Expenses, ${month}`);
        if (!created.ok || !created.id) go({ error: created.errors?.[0] });
        target = created.id!;
      }
      const result = await assignToReport(ids, target);
      if (!result.ok) go({ error: result.errors?.[0] });
      go({ view: "reports", report: target, notice: `${ids.length} added. Submit the report when it is complete.` });
    }

    async function handleTakeOff(formData: FormData) {
      "use server";
      const id = String(formData.get("id"));
      const expense = await getExpense(id);
      const result = await assignToReport([id], null);
      go({
        view: "reports",
        report: expense?.report_id,
        ...(result.ok ? { notice: "Taken off the report. It is back under My expenses." } : { error: result.errors?.[0] }),
      });
    }

    async function handleSubmit(formData: FormData) {
      "use server";
      const id = String(formData.get("id"));
      const result = await submitReport(id);
      go({ view: "reports", report: id, ...(result.ok ? { notice: "Submitted for approval." } : { error: result.errors?.[0] }) });
    }

    async function handleDeleteReport(formData: FormData) {
      "use server";
      const result = await deleteReport(String(formData.get("id")));
      go({ view: "reports", ...(result.ok ? { notice: "Report deleted. Its expenses are back under My expenses." } : { error: result.errors?.[0] }) });
    }

    async function handleDecide(formData: FormData) {
      "use server";
      const id = String(formData.get("id"));
      const approve = formData.get("decision") === "approve";
      const result = await decideReport(id, approve, text(formData, "note"));
      if (!result.ok) go({ view: "approvals", report: id, error: result.errors?.[0] });
      go({ view: "approvals", notice: approve ? "Approved." : "Returned for changes." });
    }

    async function handleReimburse(formData: FormData) {
      "use server";
      const id = String(formData.get("id"));
      const result = await markReimbursed(id);
      go({ view: "approvals", ...(result.ok ? { notice: "Marked reimbursed." } : { report: id, error: result.errors?.[0] }) });
    }

    async function handleDiscard(formData: FormData) {
      "use server";
      await voidExpense(String(formData.get("id")));
      go({ notice: "Receipt discarded." });
    }

    // --- data ------------------------------------------------------------

    const [categories, myReports, queue] = await Promise.all([
      listCategories(),
      listMyReports(viewer.id),
      viewer.isApprover ? listApprovalQueue() : Promise.resolve([] as ExpenseReport[]),
    ]);
    const categoryMap = new Map(categories.map((category) => [category.id, category]));

    async function contextFor(expenses: Expense[]) {
      const caseIds = expenses
        .filter((expense) => expense.subject_type === "case" && expense.subject_id)
        .map((expense) => expense.subject_id as string);
      const [cases, receipts] = await Promise.all([
        caseLabels([...new Set(caseIds)]),
        receiptUrls(expenses.map((expense) => expense.id)),
      ]);
      return { categories: categoryMap, cases, receipts };
    }

    const awaitingDecision = queue.filter((report) => report.status === "submitted" && report.submitted_by !== viewer.id);
    const tabs = (
      <ExpenseTabs
        view={view}
        isApprover={viewer.isApprover}
        unreportedCount={0}
        approvalCount={awaitingDecision.length}
      />
    );
    const notice = <Notice error={param("error")} notice={param("notice")} />;

    // Report detail, reached from either My reports or Approvals.
    if (reportId && view !== "mine") {
      const loaded = await getReport(reportId);
      const backHref = `${PATH}?view=${view}`;
      if (!loaded) {
        return (
          <main className="container expense-page">
            <header className="page-head">
              <span className="eyebrow">Expenses</span>
              <h1>Report not found</h1>
            </header>
            {tabs}
            <p className="callout">
              It may have been deleted, or it belongs to someone else. <a href={backHref} className="inline-link">Back</a>
            </p>
          </main>
        );
      }
      const people = [loaded.report.submitted_by, loaded.report.decided_by, loaded.report.reimbursed_by];
      const [context, names] = await Promise.all([
        contextFor(loaded.expenses),
        staffNames(people.filter((id): id is string => Boolean(id))),
      ]);
      return (
        <main className="container expense-page">
          <header className="page-head">
            <span className="eyebrow">Expense report</span>
            <h1>{loaded.report.title}</h1>
          </header>
          {tabs}
          {notice}
          <ReportDetail
            report={loaded.report}
            expenses={loaded.expenses}
            context={context}
            names={names}
            viewer={viewer}
            backHref={backHref}
            actions={{
              submit: handleSubmit,
              remove: handleTakeOff,
              deleteReport: handleDeleteReport,
              decide: handleDecide,
              reimburse: handleReimburse,
            }}
          />
        </main>
      );
    }

    if (view === "approvals") {
      const lines = await listReportLines(queue.map((report) => report.id));
      const names = await staffNames([...new Set(queue.map((report) => report.submitted_by))]);
      const rows = rowsFor(queue, lines, names);
      const pending = rows.filter((row) => row.report.status === "submitted");
      const toPay = rows.filter((row) => row.report.status === "approved");
      const href = (report: ExpenseReport) => `${PATH}?view=approvals&report=${report.id}`;
      return (
        <main className="container expense-page">
          <header className="page-head">
            <span className="eyebrow">Expenses</span>
            <h1>Approvals</h1>
            <p className="lede">Reports waiting on a decision, then approved reports waiting to be paid.</p>
          </header>
          {tabs}
          {notice}
          <SummaryStrip
            items={[
              { label: "Awaiting decision", amount: sum(pending, "total"), detail: `${pending.length} ${pending.length === 1 ? "report" : "reports"}` },
              { label: "Approved, to reimburse", amount: sum(toPay, "reimbursable"), detail: `${toPay.length} ${toPay.length === 1 ? "report" : "reports"}` },
            ]}
          />
          <section className="panel-group">
            <header className="panel-group-head">
              <h2>Awaiting decision</h2>
            </header>
            <ReportTable rows={pending} hrefFor={href} showSubmitter empty="Nothing waiting on a decision." />
          </section>
          <section className="panel-group">
            <header className="panel-group-head">
              <h2>Approved, to reimburse</h2>
            </header>
            <ReportTable rows={toPay} hrefFor={href} showSubmitter empty="Nothing approved and unpaid." />
          </section>
        </main>
      );
    }

    const myLines = await listReportLines(myReports.map((report) => report.id));
    const myRows = rowsFor(myReports, myLines);

    if (view === "reports") {
      return (
        <main className="container expense-page">
          <header className="page-head">
            <span className="eyebrow">Expenses</span>
            <h1>My reports</h1>
          </header>
          {tabs}
          {notice}
          <ReportTable
            rows={myRows}
            hrefFor={(report) => `${PATH}?view=reports&report=${report.id}`}
            empty="No reports yet. Put expenses on a report from My expenses."
          />
        </main>
      );
    }

    // My expenses
    const [expenses, rates] = await Promise.all([listMyExpenses(viewer.id), listMileageRates()]);
    const unreported = expenses.filter((expense) => expense.report_id === null);
    // Oldest draft first so a stack of scanned receipts drains in order.
    const drafts = unreported.filter((expense) => expense.status === "draft").reverse();
    const draft = drafts[0] ?? null;
    const receipt = draft ? await getReceiptForExpense(draft.id) : null;
    const draftReceiptUrl = receipt ? await receiptSignedUrl(receipt.storage_path) : null;
    const context = await contextFor(unreported);

    const year = String(new Date().getUTCFullYear());
    const unreportedTotals = reportTotals(unreported);
    const inFlight = myRows.filter((row) => row.report.status === "submitted");
    const toBePaid = myRows.filter((row) => row.report.status === "approved");
    const paidThisYear = myRows.filter(
      (row) => row.report.status === "reimbursed" && row.report.reimbursed_at?.startsWith(year),
    );
    const openReports = myReports.filter((report) => report.status === "open" || report.status === "rejected");

    return (
      <main className="container expense-page">
        <header className="page-head">
          <span className="eyebrow">Expenses</span>
          <h1>My expenses</h1>
        </header>
        <ExpenseTabs
          view={view}
          isApprover={viewer.isApprover}
          unreportedCount={unreported.length}
          approvalCount={awaitingDecision.length}
        />
        {notice}
        <ReturnedReports reports={myReports.filter((report) => report.status === "rejected")} />

        <SummaryStrip
          items={[
            { label: "Not on a report", amount: unreportedTotals.total, detail: `${unreportedTotals.count} ${unreportedTotals.count === 1 ? "expense" : "expenses"}` },
            { label: "Awaiting approval", amount: sum(inFlight, "total"), detail: `${inFlight.length} ${inFlight.length === 1 ? "report" : "reports"}` },
            { label: "Approved, not yet paid", amount: sum(toBePaid, "reimbursable"), detail: "owed to you" },
            { label: `Reimbursed in ${year}`, amount: sum(paidThisYear, "reimbursable"), detail: `${paidThisYear.length} ${paidThisYear.length === 1 ? "report" : "reports"}` },
          ]}
        />

        <div className="expense-actions">
          <ReceiptUpload onUpload={handleUpload} />
          <a href={`${PATH}?add=expense`} className="btn btn-secondary">
            Add an expense
          </a>
          <a href={`${PATH}?add=mileage`} className="btn btn-secondary">
            Log mileage
          </a>
        </div>

        {draft && !add ? (
          <DraftReviewForm
            expense={draft}
            categories={categories}
            receiptUrl={draftReceiptUrl}
            pendingCount={drafts.length}
            onConfirm={handleConfirm}
            onDiscard={handleDiscard}
          />
        ) : null}

        {add === "expense" || add === "mileage" ? (
          <NewExpenseForm
            key={add}
            categories={categories}
            rates={rates}
            mileage={add === "mileage"}
            onCreate={handleCreate}
            cancelHref={PATH}
          />
        ) : null}

        <UnreportedPanel
          expenses={unreported}
          context={context}
          openReports={openReports}
          onAssign={handleAssign}
          onRemove={handleDelete}
        />
      </main>
    );
  };
}
