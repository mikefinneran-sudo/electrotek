"use client";

// Customer-facing quote preview with Accept / Decline. Reached by an
// unguessable token link, with no login — the recipient is a prospect, not a
// user. Renders from the allow-listed PublicQuoteView, so nothing internal is
// in scope here even by accident.
//
// The token appears in the URL and in the action endpoint. That is expected —
// the recipient legitimately holds it — but it means the consuming app must
// serve this route noindex and no-store. See createPublicQuotePage.

import { useState } from "react";
import { statusLabel } from "./lifecycle";
import { formatUsd } from "./pricing";
import type { PublicQuoteView } from "./types";

export interface PublicQuoteViewProps {
  quote: PublicQuoteView;
  /** POST target for accept/decline, e.g. `/api/quote/<token>`. */
  endpoint: string;
  /** PDF download URL, e.g. `/api/quote/<token>?pdf=1`. */
  pdfUrl?: string;
  providerName: string;
}

type ActionState =
  | { status: "idle" }
  | { status: "submitting"; response: "accepted" | "declined" }
  | { status: "error"; message: string };

function formatDateLong(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function visitFrequency(visitsPerWeek: number | null): string {
  if (visitsPerWeek == null) return "—";
  if (visitsPerWeek === 0.5) return "Every other week";
  if (visitsPerWeek === 1) return "Once per week";
  if (visitsPerWeek === 5) return "Daily (Mon–Fri)";
  return `${visitsPerWeek}× per week`;
}

/** Cents shown on the line grid. The headline price stays whole-dollar. */
function formatUsdCents(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/**
 * The itemised grid, when the quote is priced by line.
 *
 * Rendered instead of the resolved sqft breakdown, not alongside it: showing a
 * customer two versions of the same money invites the question of which one they
 * are agreeing to. A quote with no lines keeps the old breakdown.
 */
function LineItemsPanel({ quote }: { quote: PublicQuoteView }) {
  const totals = quote.totals;
  return (
    <section className="panel pad" aria-label="Quote detail">
      <span className="eyebrow">What is included</span>
      {/* Wide table on a phone: let it scroll rather than squash the columns. */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "26rem" }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left", padding: "0.5rem 0.5rem 0.5rem 0" }}>
                Description
              </th>
              <th scope="col" style={{ textAlign: "right", padding: "0.5rem" }}>
                Qty
              </th>
              <th scope="col" style={{ textAlign: "right", padding: "0.5rem" }}>
                Unit price
              </th>
              <th scope="col" style={{ textAlign: "right", padding: "0.5rem" }}>
                Tax
              </th>
              <th scope="col" style={{ textAlign: "right", padding: "0.5rem 0 0.5rem 0.5rem" }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line, i) => (
              // Description is not unique — two "Deep clean" rows are legitimate
              // — so the index is the only stable key available here.
              <tr key={`${line.description}-${i}`}>
                <td style={{ padding: "0.5rem 0.5rem 0.5rem 0" }}>{line.description}</td>
                <td style={{ textAlign: "right", padding: "0.5rem" }}>
                  {formatQuantity(line.quantity)}
                </td>
                <td style={{ textAlign: "right", padding: "0.5rem" }}>
                  {formatUsdCents(line.unit_price)}
                </td>
                <td style={{ textAlign: "right", padding: "0.5rem" }}>
                  {line.tax > 0 ? formatUsdCents(line.tax) : "—"}
                </td>
                <td style={{ textAlign: "right", padding: "0.5rem 0 0.5rem 0.5rem" }}>
                  <strong>{formatUsdCents(line.line_total)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
          {totals ? (
            <tfoot>
              <tr>
                <th scope="row" colSpan={4} style={{ textAlign: "right", padding: "0.5rem" }}>
                  Subtotal
                </th>
                <td style={{ textAlign: "right", padding: "0.5rem 0 0.5rem 0.5rem" }}>
                  {formatUsdCents(totals.subtotal)}
                </td>
              </tr>
              <tr>
                <th scope="row" colSpan={4} style={{ textAlign: "right", padding: "0.5rem" }}>
                  Tax
                </th>
                <td style={{ textAlign: "right", padding: "0.5rem 0 0.5rem 0.5rem" }}>
                  {formatUsdCents(totals.tax)}
                </td>
              </tr>
              <tr>
                <th scope="row" colSpan={4} style={{ textAlign: "right", padding: "0.5rem" }}>
                  Total
                </th>
                <td style={{ textAlign: "right", padding: "0.5rem 0 0.5rem 0.5rem" }}>
                  <strong>{formatUsdCents(totals.total)}</strong>
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}

/** The banner shown once the quote is no longer open to a response. */
function ClosedNotice({ quote, providerName }: { quote: PublicQuoteView; providerName: string }) {
  if (quote.status === "accepted") {
    return (
      <div className="panel pad" role="status">
        <span className="eyebrow">Accepted</span>
        <p>
          Thank you — this quote was accepted on {formatDateLong(quote.accepted_at)}. {providerName}{" "}
          will be in touch to schedule your start date.
        </p>
      </div>
    );
  }
  if (quote.status === "declined") {
    return (
      <div className="panel pad" role="status">
        <span className="eyebrow">Declined</span>
        <p>
          This quote was declined on {formatDateLong(quote.declined_at)}. If that was not intended,
          contact {providerName} and we will reissue it.
        </p>
      </div>
    );
  }
  return (
    <div className="panel pad" role="status">
      <span className="eyebrow">Expired</span>
      <p>
        This quote was valid through {formatDateLong(quote.valid_until)} and can no longer be
        accepted online. Contact {providerName} for an updated quote — pricing is usually
        unchanged.
      </p>
    </div>
  );
}

export function PublicQuote({ quote: initial, endpoint, pdfUrl, providerName }: PublicQuoteViewProps) {
  const [quote, setQuote] = useState(initial);
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [confirming, setConfirming] = useState<"accepted" | "declined" | null>(null);

  const company = quote.prospect_company || quote.prospect_name || "your business";

  // When a quote is priced by line, the LINES are the price — the trigger summed
  // them and they are what the customer is agreeing to. `pricing.monthly` is the
  // older sqft resolution, kept for quotes that have no lines.
  const pricedByLine = quote.lines.length > 0 && quote.totals != null;
  const headline = pricedByLine ? quote.totals!.total : quote.pricing.monthly;

  async function respond(response: "accepted" | "declined") {
    setAction({ status: "submitting", response });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        setAction({
          status: "error",
          message: body?.error ?? "Could not record your response. Please try again.",
        });
        setConfirming(null);
        return;
      }
      // Re-render from the server's copy rather than optimistically: it carries
      // the authoritative status and timestamps, and it is what a refresh shows.
      setQuote(body.quote as PublicQuoteView);
      setAction({ status: "idle" });
      setConfirming(null);
    } catch {
      setAction({
        status: "error",
        message: "Could not reach the server. Check your connection and try again.",
      });
      setConfirming(null);
    }
  }

  const submitting = action.status === "submitting";

  return (
    <main className="stack" aria-labelledby="quote-heading">
      <header className="stack">
        <span className="eyebrow">Quote {quote.estimate_number}</span>
        <h1 id="quote-heading">Cleaning proposal for {company}</h1>
        <p className="price-note">
          Prepared by {providerName}
          {quote.sent_at ? ` · Issued ${formatDateLong(quote.sent_at)}` : ""}
          {quote.valid_until ? ` · Valid through ${formatDateLong(quote.valid_until)}` : ""}
        </p>
      </header>

      <section className="panel pad" aria-label="Your price">
        <span className="eyebrow">Your price</span>
        <p className="price" style={{ fontSize: "2.5rem", marginTop: "0.25rem" }}>
          {headline != null ? formatUsd(headline) : "TBD"}
          <span className="price-note">/mo</span>
        </p>
        <dl className="detail-dl" style={{ marginTop: "1rem" }}>
          <dt>Service frequency</dt>
          <dd>{visitFrequency(quote.visits_per_week)}</dd>
          <dt>Visits / month</dt>
          <dd>{quote.pricing.visitsPerMonth ?? "—"}</dd>
          {/* Per-visit and annual are derived from the sqft resolution, so they
              are only shown when that is what priced the quote. Deriving them
              from a line total that may include one-off charges would put a
              number on the page that is not true of next month. */}
          {pricedByLine ? null : (
            <>
              <dt>Per visit</dt>
              <dd>{quote.pricing.perVisit != null ? formatUsd(quote.pricing.perVisit) : "—"}</dd>
              <dt>Annual</dt>
              <dd>{quote.pricing.annual != null ? formatUsd(quote.pricing.annual) : "—"}</dd>
            </>
          )}
          {quote.cleanable_sqft ? (
            <>
              <dt>Cleanable area</dt>
              <dd>{quote.cleanable_sqft.toLocaleString()} sq ft</dd>
            </>
          ) : null}
        </dl>
      </section>

      {pricedByLine ? <LineItemsPanel quote={quote} /> : null}

      {/* Add-ons are already lines when the quote is priced by line, so listing
          them again would show the same charge twice. */}
      {!pricedByLine && quote.addons.length ? (
        <section className="panel pad" aria-label="Included add-ons">
          <span className="eyebrow">Included add-ons</span>
          <ul className="detail-list">
            {quote.addons.map((addon) => (
              <li key={addon.name}>
                {addon.name}
                {addon.price != null ? ` — ${formatUsd(addon.price)}/mo` : ""}
              </li>
            ))}
          </ul>
          {quote.pricing.addonTotal > 0 ? (
            <p className="price-note">
              Add-on subtotal {formatUsd(quote.pricing.addonTotal)}/mo, included in the monthly price
              above.
            </p>
          ) : null}
        </section>
      ) : null}

      {quote.scope_inclusions ? (
        <section className="panel pad" aria-label="Scope of work">
          <span className="eyebrow">Scope of work</span>
          <ul className="detail-list">
            {quote.scope_inclusions
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => (
                <li key={line}>{line}</li>
              ))}
          </ul>
        </section>
      ) : null}

      {quote.scope_exclusions ? (
        <section className="panel pad" aria-label="Not included">
          <span className="eyebrow">Not included</span>
          <ul className="detail-list">
            {quote.scope_exclusions
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => (
                <li key={line}>{line}</li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="panel pad" aria-label="Schedule">
        <span className="eyebrow">Schedule</span>
        <dl className="detail-dl">
          <dt>Cleaning days</dt>
          <dd>{quote.cleaning_days || "—"}</dd>
          <dt>Service window</dt>
          <dd>{quote.clean_window || "—"}</dd>
          <dt>Target start</dt>
          <dd>{quote.target_start || "—"}</dd>
          <dt>Site address</dt>
          <dd>{quote.office_address || "—"}</dd>
        </dl>
      </section>

      {pdfUrl ? (
        <p>
          <a href={pdfUrl} className="btn btn-secondary" target="_blank" rel="noreferrer">
            Download PDF
          </a>
        </p>
      ) : null}

      {quote.actionable ? (
        <section className="panel pad" aria-label="Respond to this quote">
          <span className="eyebrow">Ready to proceed?</span>

          {action.status === "error" ? (
            <p role="alert" className="form-error">
              {action.message}
            </p>
          ) : null}

          {confirming === null ? (
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting}
                onClick={() => setConfirming("accepted")}
              >
                Accept this quote
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={submitting}
                onClick={() => setConfirming("declined")}
              >
                Decline
              </button>
            </div>
          ) : (
            // Both responses are one-way — the trigger makes 'accepted' terminal
            // and a decline needs staff to reissue — so neither is a single click.
            <div className="stack">
              <p>
                {confirming === "accepted"
                  ? `Accept this quote at ${
                      headline != null ? formatUsd(headline) : "the quoted price"
                    } per month? ${providerName} will follow up to confirm your start date.`
                  : "Decline this quote? You will need to contact us if you change your mind."}
              </p>
              <div className="btn-row">
                <button
                  type="button"
                  className={confirming === "accepted" ? "btn btn-primary" : "btn btn-secondary"}
                  disabled={submitting}
                  onClick={() => respond(confirming)}
                >
                  {submitting
                    ? "Sending…"
                    : confirming === "accepted"
                      ? "Yes, accept"
                      : "Yes, decline"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={submitting}
                  onClick={() => setConfirming(null)}
                >
                  Go back
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <ClosedNotice quote={quote} providerName={providerName} />
      )}

      <p className="price-note">
        Status: {statusLabel(quote.status)}. Questions about this quote? Reply to the email it came
        from and we will pick it up.
      </p>
    </main>
  );
}
