// Server-rendered pieces of the /expenses screen. Plain forms posting to
// server actions: nothing here needs client state, so none of it ships JS.

import type { CaseLabel, Viewer } from "./server";
import type { Expense, ExpenseCategory, ExpenseReport, ExpenseReportStatus } from "./types";
import { PAYMENT_METHOD_SHORT, REPORT_STATUS_LABELS } from "./types";
import { reportTotals } from "./lifecycle";

export type ExpenseView = "mine" | "reports" | "approvals";
type FormAction = (formData: FormData) => Promise<void>;

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Totals are in USD; a line item renders in its own currency. */
export function money(amount: number | null | undefined, currency = "usd"): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    Number(amount),
  );
}

/** Date-only columns are calendar dates, not instants: format them in UTC. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  return DATE.format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

const STATUS_BADGE: Record<ExpenseReportStatus, string> = {
  open: "report-open",
  submitted: "report-submitted",
  approved: "report-approved",
  rejected: "report-rejected",
  reimbursed: "report-reimbursed",
};

export function ReportStatusBadge({ status }: { status: ExpenseReportStatus }) {
  return <span className={`badge ${STATUS_BADGE[status]}`}>{REPORT_STATUS_LABELS[status]}</span>;
}

export function ExpenseTabs({
  view,
  isApprover,
  unreportedCount,
  approvalCount,
}: {
  view: ExpenseView;
  isApprover: boolean;
  unreportedCount: number;
  approvalCount: number;
}) {
  const tabs: { key: ExpenseView; label: string; count: number | null }[] = [
    { key: "mine", label: "My expenses", count: unreportedCount },
    { key: "reports", label: "My reports", count: null },
  ];
  if (isApprover) tabs.push({ key: "approvals", label: "Approvals", count: approvalCount });
  return (
    <nav className="tabs case-toolbar" aria-label="Expense views">
      {tabs.map((tab) => (
        <a
          key={tab.key}
          href={`/expenses?view=${tab.key}`}
          className={`tab ${view === tab.key ? "active" : ""}`}
          aria-current={view === tab.key ? "page" : undefined}
        >
          {tab.label}
          {tab.count ? <span className="tab-count">{tab.count}</span> : null}
        </a>
      ))}
    </nav>
  );
}

export function Notice({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) {
    return (
      <p role="alert" className="callout expense-error">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p role="status" className="callout tint">
        {notice}
      </p>
    );
  }
  return null;
}

/** Reports sent back to their owner. They block reimbursement until fixed. */
export function ReturnedReports({ reports }: { reports: ExpenseReport[] }) {
  if (reports.length === 0) return null;
  return (
    <div className="expense-returned">
      {reports.map((report) => (
        <p key={report.id} className="callout expense-error">
          <strong>Returned for changes: </strong>
          <a href={`/expenses?view=reports&report=${report.id}`} className="inline-link">
            {report.title}
          </a>
          {report.decision_note ? <span className="expense-sub">{report.decision_note}</span> : null}
        </p>
      ))}
    </div>
  );
}

export function SummaryStrip({
  items,
}: {
  items: { label: string; amount: number; detail: string }[];
}) {
  return (
    <dl className="expense-summary">
      {items.map((item) => (
        <div key={item.label} className="expense-summary-item">
          <dt>{item.label}</dt>
          <dd className="num">{money(item.amount)}</dd>
          <dd className="expense-summary-detail">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

interface TableContext {
  categories: Map<string, ExpenseCategory>;
  cases: Map<string, CaseLabel>;
  receipts: Map<string, string>;
}

function billTo(expense: Expense, cases: Map<string, CaseLabel>) {
  if (expense.subject_type !== "case" || !expense.subject_id) {
    return <span className="expense-muted">Overhead</span>;
  }
  const label = cases.get(expense.subject_id);
  return label ? (
    <span className="expense-case" title={label.title ?? undefined}>
      {label.case_number}
    </span>
  ) : (
    <span className="expense-muted">Case</span>
  );
}

function merchant(expense: Expense) {
  return (
    <>
      <span className="expense-merchant">{expense.vendor ?? "Not yet reviewed"}</span>
      {expense.miles !== null ? (
        <span className="expense-sub">
          {expense.miles} mi at ${Number(expense.mileage_rate).toFixed(3).replace(/0$/, "")}/mi
        </span>
      ) : null}
      {expense.note ? <span className="expense-sub">{expense.note}</span> : null}
    </>
  );
}

/**
 * The line-item table every view shares. `selectForm` renders a checkbox per
 * row named expense_id, owned by that form id; `onRemove` renders a per-row
 * button posting that row's id. Both use the form= attribute because forms
 * cannot nest and cannot sit inside a table row.
 */
export function ExpenseTable({
  expenses,
  context,
  selectForm,
  onRemove,
  removeLabel = "Remove",
  empty,
}: {
  expenses: Expense[];
  context: TableContext;
  selectForm?: string;
  onRemove?: FormAction;
  removeLabel?: string;
  empty: string;
}) {
  if (expenses.length === 0) return <p className="case-empty-list">{empty}</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table expense-table">
        <thead>
          <tr>
            {selectForm ? (
              <th scope="col" className="expense-check">
                <span className="sr-only">Select</span>
              </th>
            ) : null}
            <th scope="col">Date</th>
            <th scope="col">Category</th>
            <th scope="col">Merchant / route</th>
            <th scope="col">City</th>
            <th scope="col">Bill to</th>
            <th scope="col">Paid with</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col">Receipt</th>
            {onRemove ? (
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => {
            const category = expense.category_id ? context.categories.get(expense.category_id) : undefined;
            const receipt = context.receipts.get(expense.id);
            return (
              <tr key={expense.id}>
                {selectForm ? (
                  <td className="expense-check">
                    <input
                      type="checkbox"
                      form={selectForm}
                      name="expense_id"
                      value={expense.id}
                      aria-label={`Select ${expense.vendor ?? "expense"}`}
                      disabled={expense.status === "draft"}
                    />
                  </td>
                ) : null}
                <td className="expense-date">{shortDate(expense.purchased_on)}</td>
                <td>
                  {category?.name ?? <span className="expense-muted">Uncategorised</span>}
                  {expense.status === "draft" ? <span className="badge report-open">Needs review</span> : null}
                </td>
                <td className="expense-merchant-cell">{merchant(expense)}</td>
                <td className="expense-city">{expense.city ?? <span className="expense-muted">—</span>}</td>
                <td>{billTo(expense, context.cases)}</td>
                <td className="expense-nowrap">{PAYMENT_METHOD_SHORT[expense.payment_method]}</td>
                <td className="num">{money(expense.total, expense.currency)}</td>
                <td>
                  {receipt ? (
                    <a href={receipt} target="_blank" rel="noreferrer" className="inline-link">
                      View
                    </a>
                  ) : expense.miles !== null ? (
                    <span className="expense-muted">Not needed</span>
                  ) : (
                    <span className="expense-missing">Missing</span>
                  )}
                </td>
                {onRemove ? (
                  <td className="expense-row-action">
                    <button
                      type="submit"
                      form={`remove-${expense.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      {removeLabel}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {onRemove
        ? expenses.map((expense) => (
            <form key={expense.id} id={`remove-${expense.id}`} action={onRemove} hidden>
              <input type="hidden" name="id" value={expense.id} />
            </form>
          ))
        : null}
    </div>
  );
}

/** Unreported expenses with a "put the selected ones on a report" footer. */
export function UnreportedPanel({
  expenses,
  context,
  openReports,
  onAssign,
  onRemove,
}: {
  expenses: Expense[];
  context: TableContext;
  openReports: ExpenseReport[];
  onAssign: FormAction;
  onRemove: FormAction;
}) {
  const totals = reportTotals(expenses);
  return (
    <section className="panel-group">
      <header className="panel-group-head expense-panel-head">
        <div>
          <h2>Not on a report</h2>
          <p>
            {totals.count} {totals.count === 1 ? "expense" : "expenses"}, {money(totals.total)}. Add
            them to a report to be reimbursed.
          </p>
        </div>
      </header>
      <ExpenseTable
        expenses={expenses}
        context={context}
        selectForm="assign-form"
        onRemove={onRemove}
        removeLabel="Delete"
        empty="Nothing waiting. Scan a receipt, add an expense, or log mileage."
      />
      {expenses.length > 0 ? (
        <form action={onAssign} id="assign-form">
          <div className="expense-assign">
            <label className="field">
              <span className="label">Add selected to</span>
              <select className="input" name="report_id" defaultValue="new">
                <option value="new">A new report…</option>
                {openReports.map((report) => (
                  <option key={report.id} value={report.id}>
                    {report.title} ({REPORT_STATUS_LABELS[report.status]})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">New report name</span>
              <input
                className="input"
                name="title"
                placeholder={`Expenses, ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date())}`}
              />
            </label>
            <button type="submit" className="btn">
              Add to report
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export interface ReportRow {
  report: ExpenseReport;
  count: number;
  total: number;
  reimbursable: number;
  submitter?: string;
}

export function ReportTable({
  rows,
  hrefFor,
  showSubmitter = false,
  empty,
}: {
  rows: ReportRow[];
  hrefFor: (report: ExpenseReport) => string;
  showSubmitter?: boolean;
  empty: string;
}) {
  if (rows.length === 0) return <p className="case-empty-list">{empty}</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table expense-table">
        <thead>
          <tr>
            {showSubmitter ? <th scope="col">Submitted by</th> : null}
            <th scope="col">Report</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Expenses
            </th>
            <th scope="col" className="num">
              Total
            </th>
            <th scope="col" className="num">
              Reimbursable
            </th>
            <th scope="col">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ report, count, total, reimbursable, submitter }) => (
            <tr key={report.id}>
              {showSubmitter ? <td>{submitter ?? "—"}</td> : null}
              <td>
                <a href={hrefFor(report)} className="inline-link expense-report-link">
                  {report.title}
                </a>
              </td>
              <td>
                <ReportStatusBadge status={report.status} />
              </td>
              <td className="num">{count}</td>
              <td className="num">{money(total)}</td>
              <td className="num">{money(reimbursable)}</td>
              <td className="expense-date">{shortDate(report.submitted_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="case-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ReportDetail({
  report,
  expenses,
  context,
  names,
  viewer,
  backHref,
  actions,
}: {
  report: ExpenseReport;
  expenses: Expense[];
  context: TableContext;
  names: Map<string, string>;
  viewer: Viewer;
  backHref: string;
  actions: {
    submit: FormAction;
    remove: FormAction;
    deleteReport: FormAction;
    decide: FormAction;
    reimburse: FormAction;
  };
}) {
  const totals = reportTotals(expenses);
  const isOwner = report.submitted_by === viewer.id;
  const editable = isOwner && (report.status === "open" || report.status === "rejected");
  const person = (id: string | null) => (id ? names.get(id) ?? "—" : "—");

  return (
    <section className="expense-report">
      <a href={backHref} className="back-link">
        ← Back
      </a>
      <div className="case-detail-head">
        <div className="case-detail-heading">
          <ReportStatusBadge status={report.status} />
        </div>
        <h2 className="case-detail-title">{report.title}</h2>
        <div className="case-detail-sub">
          {person(report.submitted_by)} · created {shortDate(report.created_at)}
        </div>
      </div>

      <dl className="case-field-grid">
        <Field label="Total" value={<span className="num">{money(totals.total)}</span>} />
        <Field label="Reimbursable" value={<span className="num">{money(totals.reimbursable)}</span>} />
        <Field label="Expenses" value={totals.count} />
        <Field label="Submitted" value={shortDate(report.submitted_at)} />
        <Field
          label={report.status === "rejected" ? "Returned by" : "Approved by"}
          value={report.decided_by ? `${person(report.decided_by)}, ${shortDate(report.decided_at)}` : "—"}
        />
        <Field
          label="Reimbursed"
          value={report.reimbursed_at ? `${shortDate(report.reimbursed_at)} by ${person(report.reimbursed_by)}` : "—"}
        />
      </dl>

      {report.decision_note ? (
        <p className={`callout ${report.status === "rejected" ? "expense-error" : ""}`}>
          <strong>{report.status === "rejected" ? "Returned: " : "Approver's note: "}</strong>
          {report.decision_note}
        </p>
      ) : null}

      <ExpenseTable
        expenses={expenses}
        context={context}
        onRemove={editable ? actions.remove : undefined}
        removeLabel="Take off"
        empty="No expenses on this report yet. Add them from My expenses."
      />

      {editable ? (
        <div className="expense-report-actions">
          <form action={actions.submit}>
            <input type="hidden" name="id" value={report.id} />
            <button type="submit" className="btn" disabled={totals.count === 0}>
              {report.status === "rejected" ? "Resubmit for approval" : "Submit for approval"}
            </button>
          </form>
          {report.status === "open" ? (
            <form action={actions.deleteReport}>
              <input type="hidden" name="id" value={report.id} />
              <button type="submit" className="btn btn-secondary">
                Delete report
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {viewer.isApprover && report.status === "submitted" ? (
        isOwner ? (
          <p className="callout">
            Another approver has to decide this report. Nobody approves their own spending.
          </p>
        ) : (
          <form action={actions.decide} className="expense-decide">
            <input type="hidden" name="id" value={report.id} />
            <label className="field">
              <span className="label">Note to {person(report.submitted_by)}</span>
              <textarea
                className="input"
                name="note"
                rows={2}
                placeholder="Required when returning the report"
              />
            </label>
            <div className="expense-report-actions">
              <button type="submit" name="decision" value="approve" className="btn">
                Approve {money(totals.total)}
              </button>
              <button type="submit" name="decision" value="reject" className="btn btn-secondary">
                Return for changes
              </button>
            </div>
          </form>
        )
      ) : null}

      {viewer.isApprover && report.status === "approved" ? (
        <form action={actions.reimburse} className="expense-report-actions">
          <input type="hidden" name="id" value={report.id} />
          <button type="submit" className="btn">
            Mark {money(totals.reimbursable)} reimbursed
          </button>
        </form>
      ) : null}
    </section>
  );
}
