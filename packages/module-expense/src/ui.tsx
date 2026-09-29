"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LOW_CONFIDENCE_THRESHOLD, lowConfidenceFields } from "./lifecycle";
import type { Expense, ExpenseCategory, PaymentMethod } from "./types";
import { PAYMENT_METHOD_LABELS } from "./types";

interface CaseOption {
  id: string;
  case_number: string;
  title: string;
  status: string;
}

export interface MileageRate {
  effective_on: string;
  rate: number;
}

/**
 * Case picker for billing an expense to a case.
 *
 * Cases are owned by module-crm, so this reads them over that module's public
 * route rather than importing it -- expense must not depend on crm being
 * installed. When the route is absent or fails, it falls back to a raw id
 * input so a deploy without crm still works.
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
      <label className="field">
        <span className="label">Case id</span>
        <input className="input" name="subject_id" defaultValue={initialId ?? ""} required />
      </label>
    );
  }

  return (
    <div className="case-picker">
      {/* The value the form submits. The visible control is a search box. */}
      <input type="hidden" name="subject_id" value={selected?.id ?? initialId ?? ""} />

      <label className="field">
        <span className="label">Case</span>
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

/** Firm overhead, or billed to a case. The only two answers this practice has. */
function BillTo({ initialCaseId }: { initialCaseId: string | null }) {
  const [billToCase, setBillToCase] = useState(initialCaseId !== null);
  return (
    <div className="expense-billto">
      <input type="hidden" name="subject_type" value={billToCase ? "case" : "unattributed"} />
      <span className="label">Bill to</span>
      <div className="tabs" role="radiogroup" aria-label="Bill to">
        <button
          type="button"
          role="radio"
          aria-checked={!billToCase}
          className={`tab ${billToCase ? "" : "active"}`}
          onClick={() => setBillToCase(false)}
        >
          Firm overhead
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={billToCase}
          className={`tab ${billToCase ? "active" : ""}`}
          onClick={() => setBillToCase(true)}
        >
          A case
        </button>
      </div>
      {billToCase ? <CasePicker initialId={initialCaseId} /> : null}
    </div>
  );
}

function PaidWith({ initial }: { initial: PaymentMethod }) {
  return (
    <label className="field">
      <span className="label">Paid with</span>
      <select className="input" name="payment_method" defaultValue={initial}>
        {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => (
          <option key={method} value={method}>
            {PAYMENT_METHOD_LABELS[method]}
          </option>
        ))}
      </select>
    </label>
  );
}

function Errors({ errors }: { errors: string[] }) {
  return (
    <>
      {errors.map((error) => (
        <p role="alert" className="callout expense-error" key={error}>
          {error}
        </p>
      ))}
    </>
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
    <div className="expense-upload">
      {/* The input covers the button so the whole control is the file picker,
          and `capture` opens the camera on a phone at the scene. */}
      <label className={`btn ${busy ? "is-busy" : ""}`}>
        {busy ? "Reading receipt…" : "Scan a receipt"}
        <input
          type="file"
          accept={ACCEPT}
          capture="environment"
          onChange={handleChange}
          disabled={busy}
          className="expense-upload-input"
        />
      </label>

      {/*
        A persistent banner, not a toast. When scanning is misconfigured the
        user must be told why the fields are empty -- otherwise an empty draft
        reads as "the scanner found nothing on this receipt".
      */}
      {warning ? (
        <p role="alert" className="callout tint">
          {warning}
        </p>
      ) : null}
      <Errors errors={errors} />
    </div>
  );
}

function ConfidenceHint({ field, expense }: { field: string; expense: Expense }) {
  const confidence = expense.field_confidence?.[field];
  if (confidence === undefined || confidence >= LOW_CONFIDENCE_THRESHOLD) return null;
  return (
    <span className="expense-confidence">
      check this, {Math.round(confidence * 100)}% sure
    </span>
  );
}

function CategorySelect({
  categories,
  initial,
  onChange,
  includeMileage,
}: {
  categories: ExpenseCategory[];
  initial: string | null;
  onChange?: (category: ExpenseCategory | undefined) => void;
  includeMileage: boolean;
}) {
  return (
    <label className="field">
      <span className="label">Category</span>
      <select
        className="input"
        name="category_id"
        defaultValue={initial ?? ""}
        required
        onChange={(event) => onChange?.(categories.find((c) => c.id === event.target.value))}
      >
        <option value="" disabled>
          Choose a category
        </option>
        {categories
          .filter((category) => includeMileage || !category.per_mile)
          .map((category) => (
            <option value={category.id} key={category.id}>
              {category.name}
            </option>
          ))}
      </select>
    </label>
  );
}

export function DraftReviewForm({
  expense,
  categories,
  receiptUrl,
  pendingCount,
  onConfirm,
  onDiscard,
}: {
  expense: Expense;
  categories: ExpenseCategory[];
  /** Signed, short-lived. Null when the receipt could not be resolved. */
  receiptUrl: string | null;
  /** Drafts waiting, including this one, so none sits silently behind it. */
  pendingCount: number;
  onConfirm: (formData: FormData) => Promise<{ ok: boolean; errors?: string[] }>;
  onDiscard: (formData: FormData) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
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
    <section className="panel expense-review" aria-label="Review scanned receipt">
      {/* Nobody can check a flagged field without seeing the source document. */}
      <div className="expense-review-receipt">
        {receiptUrl ? (
          // Signed URL from a private bucket; next/image cannot optimise it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={receiptUrl} alt="Scanned receipt" />
        ) : (
          <p className="case-empty-list">Receipt image unavailable. Check against the paper copy.</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="expense-form">
        <div className="expense-form-head">
          <h2>Review scanned receipt</h2>
          {pendingCount > 1 ? (
            <span className="badge">{pendingCount - 1} more waiting</span>
          ) : null}
        </div>

        {flagged.length > 0 ? (
          <p role="status" className="callout tint">
            Check {flagged.join(", ").replaceAll("_", " ")} against the receipt before saving.
          </p>
        ) : null}
        <Errors errors={errors} />

        <input type="hidden" name="id" value={expense.id} />
        <input type="hidden" name="currency" value={expense.currency} />

        <div className="expense-form-grid">
          <label className="field">
            <span className="label">
              Merchant <ConfidenceHint field="vendor" expense={expense} />
            </span>
            <input className="input" name="vendor" defaultValue={expense.vendor ?? ""} required />
          </label>
          <label className="field">
            <span className="label">
              Date <ConfidenceHint field="purchased_on" expense={expense} />
            </span>
            <input
              className="input"
              type="date"
              name="purchased_on"
              defaultValue={expense.purchased_on ?? ""}
              required
            />
          </label>
          <label className="field">
            <span className="label">
              Amount <ConfidenceHint field="total" expense={expense} />
            </span>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              name="total"
              defaultValue={expense.total === null ? "" : Number(expense.total).toFixed(2)}
              required
            />
          </label>
          <label className="field">
            <span className="label">
              Tax <ConfidenceHint field="tax" expense={expense} />
            </span>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              name="tax"
              defaultValue={expense.tax === null ? "" : Number(expense.tax).toFixed(2)}
            />
          </label>
          <CategorySelect categories={categories} initial={expense.category_id} includeMileage={false} />
          <label className="field">
            <span className="label">City</span>
            <input className="input" name="city" defaultValue={expense.city ?? ""} placeholder="Gray, IN" />
          </label>
          <PaidWith initial={expense.payment_method} />
        </div>

        <BillTo initialCaseId={expense.subject_type === "case" ? expense.subject_id : null} />

        <label className="field">
          <span className="label">Business purpose</span>
          <textarea className="input" name="note" rows={2} defaultValue={expense.note ?? ""} />
        </label>

        <div className="expense-form-actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : "Save expense"}
          </button>
        </div>
      </form>
      {/* Its own form: the review form's submit handler would swallow it. */}
      <form action={onDiscard} className="expense-discard">
        <input type="hidden" name="id" value={expense.id} />
        <button type="submit" className="btn btn-secondary btn-sm">
          Discard this receipt
        </button>
      </form>
    </section>
  );
}

const noSubscription = () => () => {};

function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Rate in force on a date, mirroring public.expense_mileage_rate_on. */
function rateOn(rates: MileageRate[], date: string): number | null {
  const applicable = rates.filter((r) => r.effective_on <= date);
  return applicable.length ? applicable[applicable.length - 1].rate : null;
}

/**
 * Hand entry for an expense with no receipt to scan, or a mileage trip. The
 * mileage total shown here is a preview; the database prices it.
 */
export function NewExpenseForm({
  categories,
  rates,
  mileage,
  onCreate,
  cancelHref,
}: {
  categories: ExpenseCategory[];
  rates: MileageRate[];
  mileage: boolean;
  onCreate: (formData: FormData) => Promise<{ ok: boolean; errors?: string[] }>;
  cancelHref: string;
}) {
  const mileageCategory = categories.find((category) => category.per_mile);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Default to the user's own calendar day, read in the browser: the server
  // runs in UTC, which is already tomorrow for an Indiana evening.
  const today = useSyncExternalStore(noSubscription, localToday, () => "");
  const [picked, setDate] = useState<string | null>(null);
  const date = picked ?? today;
  const [miles, setMiles] = useState("");

  const rate = rateOn(rates, date);
  const preview =
    rate !== null && Number(miles) > 0
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
          Math.round(Number(miles) * rate * 100) / 100,
        )
      : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    const result = await onCreate(new FormData(event.currentTarget));
    setBusy(false);
    if (!result.ok && result.errors) setErrors(result.errors);
  }

  return (
    <section className="panel pad expense-new" aria-label={mileage ? "Log mileage" : "Add an expense"}>
      <form onSubmit={handleSubmit} className="expense-form">
        <div className="expense-form-head">
          <h2>{mileage ? "Log mileage" : "Add an expense"}</h2>
        </div>
        <Errors errors={errors} />
        <input type="hidden" name="currency" value="usd" />
        {mileage ? (
          <>
            <input type="hidden" name="category_id" value={mileageCategory?.id ?? ""} />
            <input type="hidden" name="mileage" value="1" />
          </>
        ) : null}

        <div className="expense-form-grid">
          {mileage ? null : (
            <CategorySelect categories={categories} initial={null} includeMileage={false} />
          )}
          <label className="field">
            <span className="label">{mileage ? "Trip date" : "Date"}</span>
            <input
              className="input"
              type="date"
              name="purchased_on"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
          <label className="field expense-field-wide">
            <span className="label">{mileage ? "Route" : "Merchant"}</span>
            <input
              className="input"
              name="vendor"
              required
              placeholder={mileage ? "Office to 412 Elm St, Gray, IN and back" : "Hampton Inn"}
            />
          </label>
          {mileage ? (
            <label className="field">
              <span className="label">Miles</span>
              <input
                className="input"
                type="number"
                step="0.1"
                min="0.1"
                name="miles"
                value={miles}
                onChange={(event) => setMiles(event.target.value)}
                required
              />
              <span className="expense-hint">
                {rate === null
                  ? "No IRS rate on file for this date."
                  : `${preview ?? "$0.00"} at $${rate.toFixed(3).replace(/0$/, "")}/mi, the IRS rate on this date`}
              </span>
            </label>
          ) : (
            <>
              <label className="field">
                <span className="label">Amount</span>
                <input className="input" type="number" step="0.01" min="0" name="total" required />
              </label>
              <label className="field">
                <span className="label">Tax</span>
                <input className="input" type="number" step="0.01" min="0" name="tax" />
              </label>
            </>
          )}
          <label className="field">
            <span className="label">City</span>
            <input className="input" name="city" placeholder="Gray, IN" />
          </label>
          {mileage ? (
            <input type="hidden" name="payment_method" value="personal" />
          ) : (
            <PaidWith initial="personal" />
          )}
        </div>

        <BillTo initialCaseId={null} />

        <label className="field">
          <span className="label">Business purpose</span>
          <textarea className="input" name="note" rows={2} />
        </label>

        <div className="expense-form-actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : mileage ? "Save trip" : "Save expense"}
          </button>
          <a href={cancelHref} className="btn btn-secondary">
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
