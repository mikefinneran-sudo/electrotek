"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  MANUAL_SORT_BASE,
  buildGeneratedLines,
  computeTotals,
  lineTotal,
  type QuoteLineItem,
} from "./line-items";
import {
  ADDON_CATALOG,
  STANDARD_SERVICES,
  VISIT_OPTIONS,
  formatAddonExamplePrice,
  formatUsd,
  resolveQuote,
} from "./pricing";
import type { AddonCatalogItem } from "./types";

const CLEANING_DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * One row in the line editor. Strings, not numbers, because these are bound
 * straight to text inputs — a half-typed "1." is not a number and coercing on
 * every keystroke would fight the operator's cursor.
 */
interface ManualLineDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

function emptyLineDraft(): ManualLineDraft {
  return {
    // crypto.randomUUID is available in every browser this ships to, and a
    // stable key per row is what keeps React from reusing an input across rows.
    key: crypto.randomUUID(),
    description: "",
    quantity: "1",
    unitPrice: "",
    taxRate: "0",
  };
}

function draftNumber(value: string, fallback: number): number {
  if (value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Drafts the operator has actually filled in — a blank row is not a charge. */
function usableDrafts(drafts: readonly ManualLineDraft[]): ManualLineDraft[] {
  return drafts.filter((d) => d.description.trim() !== "");
}

/** The wire shape for POST/PATCH `line_items`. */
function draftsToPayload(drafts: readonly ManualLineDraft[]) {
  return usableDrafts(drafts).map((d) => ({
    description: d.description.trim(),
    quantity: draftNumber(d.quantity, 1),
    unit_price: draftNumber(d.unitPrice, 0),
    tax_rate: draftNumber(d.taxRate, 0),
  }));
}

export interface IntakeViewProps {
  endpoint?: string;
  title?: string;
  intro?: string;
  setupRequired?: boolean;
}

type SubmitState =
  | { status: "idle"; message: string }
  | { status: "submitting"; message: string }
  | { status: "success"; message: string; pdfUrl?: string }
  | { status: "error"; message: string };

interface PreviewInputs {
  cleanableSqft: string;
  visitsPerWeek: string;
  quoteRatePerSqft: string;
  quoteBaseMonthly: string;
  selectedAddonIds: Set<string>;
  manualLines: readonly ManualLineDraft[];
}

function QuotePreview({ inputs }: { inputs: PreviewInputs }) {
  const { quote, lines, totals } = useMemo(() => {
    const addons = ADDON_CATALOG.map((item) => ({
      addon_id: item.id,
      name: item.name,
      price: item.examplePrice,
      enabled: inputs.selectedAddonIds.has(item.id),
    }));
    const source = {
      cleanable_sqft: inputs.cleanableSqft ? Number(inputs.cleanableSqft) : null,
      visits_per_week: inputs.visitsPerWeek || null,
      quote_rate_per_sqft: inputs.quoteRatePerSqft ? Number(inputs.quoteRatePerSqft) : null,
      quote_base_monthly: inputs.quoteBaseMonthly ? Number(inputs.quoteBaseMonthly) : null,
    };

    // The SAME builders the server runs on save, so the preview and the stored
    // quote cannot disagree. Only enabled add-ons become lines.
    const generated = buildGeneratedLines(source, addons);
    const manual: QuoteLineItem[] = usableDrafts(inputs.manualLines).map((d, i) => ({
      product_id: null,
      sku: null,
      description: d.description.trim(),
      quantity: draftNumber(d.quantity, 1),
      unit_price: draftNumber(d.unitPrice, 0),
      tax_rate: draftNumber(d.taxRate, 0),
      origin: "manual" as const,
      origin_key: null,
      sort_order: MANUAL_SORT_BASE + i,
    }));
    const all: QuoteLineItem[] = [...generated, ...manual];

    return {
      quote: resolveQuote(source, addons),
      lines: all,
      // Same per-line-rounded arithmetic as the DB trigger, so this is the
      // figure the row will hold once saved.
      totals: computeTotals(all),
    };
  }, [inputs]);

  const hasLines = lines.length > 0;

  return (
    <aside className="panel pad" aria-label="Quote preview">
      <span className="eyebrow">Live estimate</span>
      <p className="price" style={{ fontSize: "2rem", marginTop: "0.25rem" }}>
        {hasLines
          ? formatUsd(totals.total)
          : quote.monthly != null
            ? `${formatUsd(quote.monthly)}`
            : "TBD"}
        <span className="price-note">/mo</span>
      </p>

      {hasLines ? (
        <>
          <ul className="detail-list" style={{ marginTop: "0.75rem" }}>
            {lines.map((line) => (
              <li key={`${line.origin_key ?? "manual"}-${line.sort_order}`}>
                {line.description}
                {line.quantity !== 1 ? ` × ${line.quantity}` : ""} — {formatUsd(lineTotal(line))}
              </li>
            ))}
          </ul>
          <dl className="detail-dl" style={{ marginTop: "0.75rem" }}>
            <dt>Subtotal</dt>
            <dd>{formatUsd(totals.subtotal)}</dd>
            <dt>Tax</dt>
            <dd>{totals.tax > 0 ? formatUsd(totals.tax) : "—"}</dd>
            <dt>Total</dt>
            <dd>
              <strong>{formatUsd(totals.total)}</strong>
            </dd>
          </dl>
        </>
      ) : null}

      <dl className="detail-dl" style={{ marginTop: "1rem" }}>
        <dt>Base monthly</dt>
        <dd>{quote.baseMonthly != null ? formatUsd(quote.baseMonthly) : formatUsd(quote.suggestedBase, "—")}</dd>
        <dt>Add-ons</dt>
        <dd>{quote.addonTotal > 0 ? `${formatUsd(quote.addonTotal)}/mo` : "—"}</dd>
        <dt>Visits / month</dt>
        <dd>{quote.visitsPerMonth != null ? quote.visitsPerMonth : "—"}</dd>
        <dt>Est. per visit</dt>
        <dd>{quote.perVisit != null ? formatUsd(Math.round(quote.perVisit)) : "—"}</dd>
        <dt>Est. annual</dt>
        <dd>{quote.annual != null ? formatUsd(quote.annual) : "—"}</dd>
      </dl>

      <p className="price-note" style={{ display: "block", marginTop: "0.75rem" }}>
        Estimate only — final pricing is confirmed after the walkthrough.
      </p>
    </aside>
  );
}

function StandardServicesNote() {
  return (
    <div className="callout tint">
      <strong>Included in every base quote:</strong>{" "}
      {STANDARD_SERVICES.map((s) => s.name).join(" · ")}
    </div>
  );
}

function AddonRow({
  item,
  checked,
  onToggle,
}: {
  item: AddonCatalogItem;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const price = formatAddonExamplePrice(item);
  return (
    <label
      className="order-row"
      style={{ cursor: "pointer", borderRadius: "var(--radius)" }}
    >
      <input
        type="checkbox"
        name="addons"
        value={item.id}
        checked={checked}
        onChange={(e) => onToggle(item.id, e.currentTarget.checked)}
      />
      <span style={{ flex: 1 }}>
        <strong style={{ display: "block" }}>{item.name}</strong>
        <span className="price-note" style={{ marginLeft: 0 }}>
          Billed separately on top of base monthly
        </span>
      </span>
      {price ? <span className="badge low-stock">≈ {price}</span> : null}
    </label>
  );
}

/**
 * The manual line editor.
 *
 * Only MANUAL lines are editable here. The base service line and the add-on
 * lines are generated from the walkthrough and rebuilt by the server on every
 * save, so offering them for editing would promise the operator a change that
 * the next regenerate silently reverts.
 */
function LineEditor({
  drafts,
  onChange,
}: {
  drafts: readonly ManualLineDraft[];
  onChange: (next: ManualLineDraft[]) => void;
}) {
  function patch(key: string, field: keyof Omit<ManualLineDraft, "key">, value: string) {
    onChange(drafts.map((d) => (d.key === key ? { ...d, [field]: value } : d)));
  }

  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <span className="label">Additional lines</span>
      <p className="price-note" style={{ marginLeft: 0, display: "block" }}>
        One-off charges, negotiated adjustments, or anything the add-on list does not cover. The
        recurring service line and the add-ons above are added automatically.
      </p>

      <div className="order-list">
        {drafts.map((draft) => (
          <div
            key={draft.key}
            className="order-row"
            style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}
          >
            <label className="field" style={{ flex: "3 1 12rem" }}>
              <span className="label">Description</span>
              <input
                className="input"
                value={draft.description}
                placeholder="First-visit deep clean"
                onChange={(e) => patch(draft.key, "description", e.currentTarget.value)}
              />
            </label>
            <label className="field" style={{ flex: "0 1 5rem" }}>
              <span className="label">Qty</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={draft.quantity}
                onChange={(e) => patch(draft.key, "quantity", e.currentTarget.value)}
              />
            </label>
            <label className="field" style={{ flex: "0 1 7rem" }}>
              <span className="label">Unit price</span>
              <input
                className="input"
                type="number"
                step="0.01"
                value={draft.unitPrice}
                onChange={(e) => patch(draft.key, "unitPrice", e.currentTarget.value)}
              />
            </label>
            <label className="field" style={{ flex: "0 1 5.5rem" }}>
              <span className="label">Tax %</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.001"
                value={draft.taxRate}
                onChange={(e) => patch(draft.key, "taxRate", e.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              className="btn ghost"
              aria-label={`Remove line ${draft.description || "(untitled)"}`}
              onClick={() => onChange(drafts.filter((d) => d.key !== draft.key))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn ghost"
        style={{ marginTop: "0.5rem" }}
        onClick={() => onChange([...drafts, emptyLineDraft()])}
      >
        Add line
      </button>
    </fieldset>
  );
}

/**
 * The walkthrough intake wizard. Captures the inspection fields, shows a live
 * quote estimate, and POSTs/PATCHes to the inspection API. On success it links
 * to the streamed quote PDF (GET ?pdf=1).
 */
export function IntakeView({
  endpoint = "/api/inspection",
  title = "New walkthrough",
  intro = "Capture the walkthrough details and we'll draft the quote.",
  setupRequired = false,
}: IntakeViewProps) {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<SubmitState>({ status: "idle", message: "" });
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<string>>(new Set());
  const [manualLines, setManualLines] = useState<ManualLineDraft[]>([]);
  const [preview, setPreview] = useState<PreviewInputs>({
    cleanableSqft: "",
    visitsPerWeek: "",
    quoteRatePerSqft: "",
    quoteBaseMonthly: "",
    selectedAddonIds: new Set(),
    manualLines: [],
  });

  const TOTAL = 3;
  const stepTitles = ["", "Who is the client?", "How big & how often?", "What do we clean?"];
  const stepHints = [
    "",
    "Name and company are required. Add contact details and address if you have them.",
    "Square footage, visit frequency, room counts, and site access drive the base monthly quote.",
    "Add-on services and site-specific scope — final add-on pricing is confirmed on the quote.",
  ];

  function syncPreview(patch: Partial<PreviewInputs>) {
    setPreview((prev) => ({ ...prev, ...patch }));
  }

  function toggleAddon(id: string, checked: boolean) {
    setSelectedAddonIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      syncPreview({ selectedAddonIds: next });
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if ((form.elements.namedItem("website") as HTMLInputElement)?.value) return;

    setState({ status: "submitting", message: "Saving…" });

    const data = new FormData(form);
    const cleaningDays = data.getAll("cleaning_days").join(", ");
    const addons = ADDON_CATALOG.filter((item) => selectedAddonIds.has(item.id)).map((item) => ({
      addon_id: item.id,
      name: item.name,
      price: item.examplePrice,
      enabled: true,
    }));

    const payload: Record<string, unknown> = {
      prospect_name: data.get("prospect_name"),
      prospect_company: data.get("prospect_company"),
      prospect_email: data.get("prospect_email"),
      prospect_phone: data.get("prospect_phone"),
      office_address: data.get("office_address"),
      walkthrough_date: data.get("walkthrough_date") || null,
      cleanable_sqft: data.get("cleanable_sqft") ? Number(data.get("cleanable_sqft")) : null,
      visits_per_week: data.get("visits_per_week") ? Number(data.get("visits_per_week")) : null,
      number_of_offices: data.get("number_of_offices") ? Number(data.get("number_of_offices")) : null,
      number_of_board_rooms: data.get("number_of_board_rooms")
        ? Number(data.get("number_of_board_rooms"))
        : null,
      dumpster_access: data.get("dumpster_access"),
      parking_access: data.get("parking_access"),
      water_access: data.get("water_access"),
      cleaning_days: cleaningDays,
      clean_window: data.get("clean_window"),
      consumables_provided_by: data.get("consumables_provided_by"),
      scope_inclusions: data.get("scope_inclusions"),
      scope_exclusions: data.get("scope_exclusions"),
      current_cleaner: data.get("current_cleaner"),
      current_cleaner_issues: data.get("current_cleaner_issues"),
      target_start: data.get("target_start"),
      decision_process: data.get("decision_process"),
      internal_notes: data.get("internal_notes"),
      quote_rate_per_sqft: data.get("quote_rate_per_sqft")
        ? Number(data.get("quote_rate_per_sqft"))
        : null,
      quote_base_monthly: data.get("quote_base_monthly")
        ? Number(data.get("quote_base_monthly"))
        : null,
      addons,
      // Manual lines only. The base service line and the add-on lines are
      // generated server-side from the fields above — sending them from here
      // would be a second pricing path, which is the thing the line-item model
      // was adopted to remove.
      line_items: draftsToPayload(manualLines),
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        setState({ status: "error", message: result.error ?? "Could not save the inspection." });
        return;
      }
      setState({
        status: "success",
        message: "Inspection saved. The quote is ready to download.",
        pdfUrl: result.id ? `${endpoint}?id=${encodeURIComponent(result.id)}&pdf=1` : undefined,
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not save the inspection.",
      });
    }
  }

  if (setupRequired) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Quote engine</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Setup required.</strong> Inspections and quotes are not yet
            configured for this site. Contact your administrator.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="container">
        <header className="page-head">
          <span className="eyebrow">Quote engine</span>
          <h1>{title}</h1>
          <p className="lede">{intro}</p>
        </header>

        <div className="catalog-layout">
          <form onSubmit={onSubmit} className="form">
            <input aria-hidden="true" autoComplete="off" name="website" tabIndex={-1} className="honeypot" />

            <div className="tabs" role="status" style={{ justifyContent: "space-between" }}>
              <strong>{stepTitles[step]}</strong>
              <span className="price-note" style={{ marginLeft: 0 }}>
                Step {step} of {TOTAL}
              </span>
            </div>
            <p className="price-note" style={{ marginLeft: 0 }}>
              {stepHints[step]}
            </p>

            {step === 1 ? (
              <div className="panel pad form">
                <div className="form-row">
                  <label className="field">
                    <span className="label">Contact name *</span>
                    <input className="input" name="prospect_name" autoComplete="name" required />
                  </label>
                  <label className="field">
                    <span className="label">Company *</span>
                    <input className="input" name="prospect_company" autoComplete="organization" required />
                  </label>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span className="label">Email</span>
                    <input className="input" name="prospect_email" type="email" autoComplete="email" />
                  </label>
                  <label className="field">
                    <span className="label">Phone</span>
                    <input className="input" name="prospect_phone" autoComplete="tel" />
                  </label>
                </div>
                <label className="field">
                  <span className="label">Office address</span>
                  <input className="input" name="office_address" autoComplete="street-address" />
                </label>
                <label className="field">
                  <span className="label">Walkthrough date</span>
                  <input className="input" name="walkthrough_date" type="date" />
                </label>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="panel pad form">
                <div className="form-row">
                  <label className="field">
                    <span className="label">Cleanable sqft</span>
                    <input
                      className="input"
                      name="cleanable_sqft"
                      type="number"
                      min="0"
                      onChange={(e) => syncPreview({ cleanableSqft: e.currentTarget.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="label">Visits per week</span>
                    <select
                      className="input"
                      name="visits_per_week"
                      defaultValue=""
                      onChange={(e) => syncPreview({ visitsPerWeek: e.currentTarget.value })}
                    >
                      <option value="">Select…</option>
                      {VISIT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span className="label">Number of offices</span>
                    <input className="input" name="number_of_offices" type="number" min="0" />
                  </label>
                  <label className="field">
                    <span className="label">Number of board rooms</span>
                    <input className="input" name="number_of_board_rooms" type="number" min="0" />
                  </label>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span className="label">Rate ($/sqft per visit)</span>
                    <input
                      className="input"
                      name="quote_rate_per_sqft"
                      type="number"
                      step="0.0001"
                      placeholder="0.01"
                      onChange={(e) => syncPreview({ quoteRatePerSqft: e.currentTarget.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="label">Base monthly override</span>
                    <input
                      className="input"
                      name="quote_base_monthly"
                      type="number"
                      step="0.01"
                      onChange={(e) => syncPreview({ quoteBaseMonthly: e.currentTarget.value })}
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span className="label">Dumpster access</span>
                    <input className="input" name="dumpster_access" />
                  </label>
                  <label className="field">
                    <span className="label">Parking access</span>
                    <input className="input" name="parking_access" />
                  </label>
                  <label className="field">
                    <span className="label">Water access</span>
                    <input className="input" name="water_access" />
                  </label>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="panel pad form">
                <StandardServicesNote />

                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <span className="label">Optional add-ons</span>
                  <div className="order-list">
                    {ADDON_CATALOG.map((item) => (
                      <AddonRow
                        key={item.id}
                        item={item}
                        checked={selectedAddonIds.has(item.id)}
                        onToggle={toggleAddon}
                      />
                    ))}
                  </div>
                </fieldset>

                <LineEditor
                  drafts={manualLines}
                  onChange={(next) => {
                    setManualLines(next);
                    syncPreview({ manualLines: next });
                  }}
                />

                <label className="field">
                  <span className="label">Scope inclusions (one per line)</span>
                  <textarea className="input" name="scope_inclusions" rows={4} />
                </label>
                <label className="field">
                  <span className="label">Scope exclusions (one per line)</span>
                  <textarea className="input" name="scope_exclusions" rows={3} />
                </label>

                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <span className="label">Cleaning days</span>
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                    {CLEANING_DAY_OPTIONS.map((day) => (
                      <label key={day} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                        <input type="checkbox" name="cleaning_days" value={day} />
                        {day}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="form-row">
                  <label className="field">
                    <span className="label">Clean window</span>
                    <input className="input" name="clean_window" placeholder="After 6pm" />
                  </label>
                  <label className="field">
                    <span className="label">Target start</span>
                    <input className="input" name="target_start" />
                  </label>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span className="label">Consumables provided by</span>
                    <input className="input" name="consumables_provided_by" placeholder="Provider / Client / Split" />
                  </label>
                  <label className="field">
                    <span className="label">Current cleaner</span>
                    <input className="input" name="current_cleaner" />
                  </label>
                </div>
                <label className="field">
                  <span className="label">Current cleaner issues</span>
                  <textarea className="input" name="current_cleaner_issues" rows={2} />
                </label>
                <label className="field">
                  <span className="label">Decision process</span>
                  <textarea className="input" name="decision_process" rows={2} />
                </label>
                <label className="field">
                  <span className="label">Internal notes</span>
                  <textarea className="input" name="internal_notes" rows={2} />
                </label>
              </div>
            ) : null}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                flexWrap: "wrap",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="btn ghost"
                  hidden={step <= 1}
                  onClick={() => setStep((s) => Math.max(1, s - 1))}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn"
                  hidden={step >= TOTAL}
                  onClick={() => setStep((s) => Math.min(TOTAL, s + 1))}
                >
                  Next
                </button>
                <button
                  type="submit"
                  className="btn"
                  hidden={step !== TOTAL}
                  disabled={state.status === "submitting"}
                >
                  {state.status === "submitting" ? "Saving…" : "Save & build quote"}
                </button>
              </div>

              {state.message ? (
                <p
                  role={state.status === "error" ? "alert" : "status"}
                  className={`form-msg ${state.status === "error" ? "error" : "success"}`}
                >
                  {state.message}{" "}
                  {state.status === "success" && state.pdfUrl ? (
                    <a className="inline-link" href={state.pdfUrl} target="_blank" rel="noreferrer">
                      Download quote PDF
                    </a>
                  ) : null}
                </p>
              ) : null}
            </div>
          </form>

          <QuotePreview inputs={{ ...preview, selectedAddonIds, manualLines }} />
        </div>
      </section>
    </div>
  );
}
