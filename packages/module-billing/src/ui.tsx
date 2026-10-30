"use client";

import { useCallback, useEffect, useState } from "react";
import type { Invoice, InvoiceStatus } from "./types";
import { INVOICE_STATUSES } from "./types";

function isPastDue(inv: Invoice): boolean {
  if (!inv.due_date) return false;
  if (inv.status !== "open") return false;
  // ISO date strings compare correctly as plain strings (YYYY-MM-DD).
  const today = new Date().toISOString().slice(0, 10);
  return inv.due_date < today;
}

export interface BillingViewProps {
  endpoint?: string;
  title?: string;
  setupRequired?: boolean;
  /** Open the new-invoice form on load, for /billing?new=invoice deep links. */
  openForm?: boolean;
}

function statusBadge(status: InvoiceStatus): string {
  const labels: Record<InvoiceStatus, string> = {
    draft: "Draft",
    open: "Open",
    paid: "Paid",
    void: "Void",
    uncollectible: "Uncollectible",
  };
  return labels[status] ?? status;
}

function formatAmount(amount: number | null, currency: string): string {
  if (amount == null) return "Unpriced";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span className="eyebrow" style={{ display: "block", marginBottom: "0.25rem" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

export function BillingView({
  endpoint = "/api/billing",
  title = "Billing",
  setupRequired = false,
  openForm = false,
}: BillingViewProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(openForm);

  const reload = useCallback(async () => {
    const res = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Could not load billing data (${res.status}).`);
    const data = (await res.json().catch(() => ({}))) as { invoices?: Invoice[] };
    setInvoices(data.invoices ?? []);
  }, [endpoint]);

  useEffect(() => {
    if (setupRequired) {
      // No state reset needed: when setupRequired is true the component
      // returns the setup callout before `loading` is ever read.
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load billing data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, setupRequired]);

  const mutate = useCallback(
    async (method: "POST" | "PATCH", body: Record<string, unknown>, okMsg: string) => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        const res = await fetch(endpoint, {
          method,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `Request failed (${res.status}).`);
        }
        await reload();
        setNotice(okMsg);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed.");
      } finally {
        setBusy(false);
      }
    },
    [endpoint, reload],
  );

  const copyPayLink = useCallback(
    async (invoiceId: string) => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ action: "pay-link", id: invoiceId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          url?: string;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `Request failed (${res.status}).`);
        }
        const url = data.url ?? "";
        try {
          await navigator.clipboard.writeText(url);
          setNotice("Pay link copied to clipboard.");
        } catch {
          setNotice(`Pay link: ${url}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not generate pay link.");
      } finally {
        setBusy(false);
      }
    },
    [endpoint],
  );

  if (setupRequired) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Billing</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Setup required.</strong> Billing is not yet configured for
            this site. Contact your administrator.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="container">
        <header className="page-head">
          <span className="eyebrow">Billing</span>
          <h1>{title}</h1>
        </header>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setShowForm((value) => !value)} disabled={busy}>
            {showForm ? "Cancel" : "New invoice"}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setError(null);
              void reload().catch((err) =>
                setError(err instanceof Error ? err.message : "Could not refresh."),
              );
            }}
            disabled={busy}
          >
            Refresh
          </button>
        </div>

        {notice ? (
          <p className="form-msg" style={{ color: "var(--accent)" }}>
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="form-msg error">
            {error}
          </p>
        ) : null}

        {showForm ? (
          <InvoiceForm
            busy={busy}
            onSubmit={async (body) => {
              await mutate("POST", body, "Invoice created.");
              setShowForm(false);
            }}
          />
        ) : null}

        {loading ? (
          <p className="price-note">Loading...</p>
        ) : invoices.length === 0 ? (
          <p className="price-note">No invoices found.</p>
        ) : (
          <div className="order-list" style={{ marginTop: "1rem" }}>
            {invoices.map((inv) => (
              <div key={inv.id} className="order-row">
                <div style={{ flex: 1, minWidth: 180 }}>
                  <strong>{inv.number}</strong>
                  {inv.due_date ? (
                    <span className="price-note" style={{ marginLeft: "0.5rem" }}>
                      Due {inv.due_date}
                    </span>
                  ) : null}
                </div>
                <span className="badge">{statusBadge(inv.status)}</span>
                {isPastDue(inv) ? (
                  <span
                    className="badge"
                    style={{ background: "var(--red, #b91c1c)", color: "#fff" }}
                  >
                    Past due
                  </span>
                ) : null}
                <EditableAmount
                  inv={inv}
                  busy={busy}
                  onSave={(id, amount) =>
                    mutate("PATCH", { id, amount_due: amount }, "Amount updated.")
                  }
                />
                <select
                  value={inv.status}
                  disabled={busy}
                  onChange={(e) =>
                    mutate(
                      "PATCH",
                      { id: inv.id, status: e.target.value },
                      "Invoice status updated.",
                    )
                  }
                >
                  {INVOICE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusBadge(status)}
                    </option>
                  ))}
                </select>
                <button
                  className="btn ghost"
                  disabled={busy || inv.status === "paid"}
                  onClick={() =>
                    mutate("PATCH", { id: inv.id, status: "paid" }, "Invoice marked paid.")
                  }
                >
                  Mark paid
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => copyPayLink(inv.id)}
                >
                  Pay link
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EditableAmount({
  inv,
  busy,
  onSave,
}: {
  inv: Invoice;
  busy: boolean;
  onSave: (id: string, amount: number) => void;
}) {
  const isDraft = inv.status === "draft";
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(inv.amount_due ?? ""));

  if (!isDraft || !editing) {
    return (
      <span
        style={{
          minWidth: "7rem",
          textAlign: "right",
          cursor: isDraft ? "pointer" : undefined,
          textDecoration: isDraft ? "underline dotted" : undefined,
        }}
        title={isDraft ? "Click to edit amount" : undefined}
        onClick={
          isDraft && !busy
            ? () => {
                setRaw(String(inv.amount_due ?? ""));
                setEditing(true);
              }
            : undefined
        }
      >
        {formatAmount(inv.amount_due, inv.currency)}
      </span>
    );
  }

  return (
    <input
      type="number"
      min="0"
      step="0.01"
      value={raw}
      autoFocus
      style={{ width: "7rem" }}
      disabled={busy}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0 && n !== inv.amount_due) {
          onSave(inv.id, n);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setEditing(false);
          setRaw(String(inv.amount_due ?? ""));
        }
      }}
    />
  );
}

function InvoiceForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [number, setNumber] = useState("");
  const [amountDue, setAmountDue] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<InvoiceStatus>("draft");
  const [localErr, setLocalErr] = useState<string | null>(null);

  return (
    <div
      className="panel pad"
      style={{ display: "grid", gap: "0.75rem", maxWidth: 760, marginBottom: "1rem" }}
    >
      <span className="eyebrow">New invoice</span>
      {localErr ? (
        <p role="alert" className="form-msg error">
          {localErr}
        </p>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <Field label="Invoice number *">
          <input value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label="Amount due *">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amountDue}
            onChange={(e) => setAmountDue(e.target.value)}
          />
        </Field>
        <Field label="Currency">
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toLowerCase())} />
        </Field>
        <Field label="Due date">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus)}>
            {INVOICE_STATUSES.map((invoiceStatus) => (
              <option key={invoiceStatus} value={invoiceStatus}>
                {statusBadge(invoiceStatus)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div>
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            const parsedAmount = Number(amountDue);
            if (!number.trim()) {
              setLocalErr("Invoice number is required.");
              return;
            }
            if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
              setLocalErr("Amount due must be a finite number greater than or equal to 0.");
              return;
            }
            setLocalErr(null);
            void onSubmit({
              number: number.trim(),
              amount_due: parsedAmount,
              currency: currency.trim() || "usd",
              status,
              ...(dueDate ? { due_date: dueDate } : {}),
            });
          }}
        >
          Create invoice
        </button>
      </div>
    </div>
  );
}
