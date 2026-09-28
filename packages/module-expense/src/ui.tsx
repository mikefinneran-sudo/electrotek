"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOW_CONFIDENCE_THRESHOLD, lowConfidenceFields } from "./lifecycle";
import type { Expense, ExpenseCategory, ExpenseSubjectType } from "./types";

interface CaseOption {
  id: string;
  case_number: string;
  title: string;
  status: string;
}

/**
 * Case picker for expense attribution.
 *
 * Attribution used to be a bare text input labelled "Attributed to (id)": to
 * bill a receipt to a case, a staff member had to paste a uuid. Nobody knows a
 * uuid. In practice that meant expenses were left unattributed, which for a
 * forensic practice means reimbursable scene travel never reaches the invoice.
 *
 * Cases are owned by module-crm, so this reads them over that module's public
 * route rather than importing it — expense must not depend on crm being
 * installed. When the route is absent (crm not enabled for this client) or
 * fails, the component falls back to the raw id input, so a deploy without crm
 * behaves exactly as it did before.
 */
function CasePicker({ initialId }: { initialId: string | null }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CaseOption[]>([]);
  const [selected, setSelected] = useState<CaseOption | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (search: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams({ entity: "cases", limit: "8" });
    if (search.trim()) params.set("search", search.trim());

    try {
      const res = await fetch(`/api/crm-records?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const body = (await res.json()) as { cases?: CaseOption[] };
      setOptions(body.cases ?? []);
    } catch (error) {
      // An aborted request is the expected path when typing, not a failure.
      if ((error as Error)?.name === "AbortError") return;
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void load(query), 200);
    return () => clearTimeout(handle);
  }, [query, load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (unavailable) {
    return (
      <label>
        Attributed to (id)
        <input name="subject_id" defaultValue={initialId ?? ""} required />
      </label>
    );
  }

  return (
    <div className="case-picker">
      {/* The value the form actually submits. The visible control below is a
          search box, so the id travels in a hidden field. */}
      <input type="hidden" name="subject_id" value={selected?.id ?? initialId ?? ""} />

      <label>
        Case
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search case number or title"
          aria-label="Search cases"
        />
      </label>

      {selected ? (
        <p className="case-picker-selected">
          <strong>{selected.case_number}</strong> {selected.title}
          <button type="button" onClick={() => setSelected(null)}>
            Change
          </button>
        </p>
      ) : (
        <ul className="case-picker-results">
          {options.map((option) => (
            <li key={option.id}>
              <button type="button" onClick={() => setSelected(option)}>
                <strong>{option.case_number}</strong> {option.title}
                <span>{option.status}</span>
              </button>
            </li>
          ))}
          {options.length === 0 ? <li className="case-picker-empty">No matching cases.</li> : null}
        </ul>
      )}
    </div>
  );
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export interface UploadOutcome {
  ok: boolean;
  id?: string;
  warning?: string;
  errors?: string[];
}

export function ReceiptUpload({
  onUpload,
}: {
  onUpload: (formData: FormData) => Promise<UploadOutcome>;
}) {
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setWarning(null);
    setErrors([]);

    const formData = new FormData();
    formData.set("receipt", file);
    const result = await onUpload(formData);

    setBusy(false);
    event.target.value = "";
    if (result.warning) setWarning(result.warning);
    if (result.errors?.length) setErrors(result.errors);
  }

  return (
    <section>
      <h2>Add a receipt</h2>

      {/*
        A persistent banner, not a toast. When scanning is misconfigured the
        operator must be told why the fields are empty — otherwise an empty
        draft reads as "the scanner found nothing on this receipt", which is a
        different and wrong conclusion.
      */}
      {warning ? (
        <p role="alert" data-variant="warning">
          {warning}
        </p>
      ) : null}

      {errors.map((error) => (
        <p role="alert" data-variant="error" key={error}>
          {error}
        </p>
      ))}

      <label>
        Receipt photo
        <input type="file" accept={ACCEPT} onChange={handleChange} disabled={busy} />
      </label>
      {busy ? <p>Reading receipt…</p> : null}
    </section>
  );
}

function ConfidenceHint({ field, expense }: { field: string; expense: Expense }) {
  const confidence = expense.field_confidence?.[field];
  if (confidence === undefined || confidence >= LOW_CONFIDENCE_THRESHOLD) return null;
  return (
    <span data-variant="warning">
      {" "}
      check this — {Math.round(confidence * 100)}% confident
    </span>
  );
}

export function DraftReviewForm({
  expense,
  categories,
  receiptUrl,
  pendingCount,
  onConfirm,
}: {
  expense: Expense;
  categories: ExpenseCategory[];
  /** Signed, short-lived. Null when the receipt could not be resolved. */
  receiptUrl: string | null;
  /** Total drafts waiting, including this one. Surfaces the backlog so a
      queued-but-unreachable draft never sits silent behind this one. */
  pendingCount: number;
  onConfirm: (formData: FormData) => Promise<{ ok: boolean; errors?: string[] }>;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [subjectType, setSubjectType] = useState<ExpenseSubjectType>(
    expense.subject_type ?? "unattributed",
  );
  const flagged = lowConfidenceFields(expense);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    const result = await onConfirm(new FormData(event.currentTarget));
    setBusy(false);
    if (!result.ok && result.errors) setErrors(result.errors);
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Review draft</h2>

      {pendingCount > 1 ? (
        <p role="status">Reviewing the oldest of {pendingCount} pending receipts.</p>
      ) : null}

      {flagged.length > 0 ? (
        <p role="status">
          Check these before confirming: {flagged.join(", ")}.
        </p>
      ) : null}

      {/* The operator cannot verify a flagged field without seeing the source
          document. Showing the receipt is what makes confirmation meaningful. */}
      {receiptUrl ? (
        <img src={receiptUrl} alt="Uploaded receipt" data-role="receipt-preview" />
      ) : (
        <p>Receipt image unavailable — verify against the paper copy.</p>
      )}

      {errors.map((error) => (
        <p role="alert" data-variant="error" key={error}>
          {error}
        </p>
      ))}

      <input type="hidden" name="id" value={expense.id} />

      <label>
        Vendor
        <ConfidenceHint field="vendor" expense={expense} />
        <input name="vendor" defaultValue={expense.vendor ?? ""} required />
      </label>

      <label>
        Purchased on
        <ConfidenceHint field="purchased_on" expense={expense} />
        <input type="date" name="purchased_on" defaultValue={expense.purchased_on ?? ""} required />
      </label>

      <label>
        Total
        <ConfidenceHint field="total" expense={expense} />
        <input
          type="number"
          step="0.01"
          min="0"
          name="total"
          defaultValue={expense.total ?? ""}
          required
        />
      </label>

      <label>
        Tax
        <ConfidenceHint field="tax" expense={expense} />
        <input type="number" step="0.01" min="0" name="tax" defaultValue={expense.tax ?? ""} />
      </label>

      <label>
        Currency
        <input name="currency" defaultValue={expense.currency} required />
      </label>

      <label>
        Category
        <select name="category_id" defaultValue={expense.category_id ?? ""}>
          <option value="">Uncategorised</option>
          {categories.map((category) => (
            <option value={category.id} key={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Attribution
        <select
          name="subject_type"
          value={subjectType}
          onChange={(event) => setSubjectType(event.target.value as ExpenseSubjectType)}
        >
          <option value="unattributed">Unattributed</option>
          <option value="case">Case</option>
          <option value="customer">Customer</option>
          <option value="opportunity">Opportunity</option>
        </select>
      </label>

      {subjectType === "case" ? (
        <CasePicker initialId={expense.subject_id} />
      ) : subjectType !== "unattributed" ? (
        <label>
          Attributed to (id)
          <input name="subject_id" defaultValue={expense.subject_id ?? ""} required />
        </label>
      ) : null}

      <label>
        Note
        <textarea name="note" defaultValue={expense.note ?? ""} />
      </label>

      {/* Disabled only while submitting — never as the way of signalling a
          configuration problem. That is what the banner above is for. */}
      <button type="submit" disabled={busy}>
        {busy ? "Confirming…" : "Confirm expense"}
      </button>
    </form>
  );
}

export function ExpenseList({ expenses }: { expenses: Expense[] }) {
  if (expenses.length === 0) return <p>No expenses yet.</p>;

  return (
    <table>
      <caption>Expenses</caption>
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Vendor</th>
          <th scope="col">Date</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {expenses.map((expense) => (
          <tr key={expense.id}>
            <td>
              <span data-status={expense.status}>{expense.status}</span>
            </td>
            <td>{expense.vendor ?? "—"}</td>
            <td>{expense.purchased_on ?? "—"}</td>
            <td>
              {expense.total === null
                ? "—"
                : new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: expense.currency.toUpperCase(),
                  }).format(expense.total)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
