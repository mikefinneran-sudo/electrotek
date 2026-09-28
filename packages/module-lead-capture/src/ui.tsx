"use client";

import { FormEvent, useState } from "react";
import { FIELD_LIMITS } from "./validation";
import type { LeadAttachmentRecord } from "./index";

export interface LeadFormProps {
  endpoint?: string;
  title?: string;
  intro?: string;
  submitLabel?: string;
}

type FormState =
  | { status: "idle"; message: string }
  | { status: "submitting"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export interface LeadDetailsProps {
  metadata?: Record<string, unknown> | null;
  attachments?: readonly LeadAttachmentRecord[] | null;
}

function detailLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function detailValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(detailValue).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function attachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Staff-facing details shared by lead-list surfaces. */
export function LeadDetails({ metadata, attachments }: LeadDetailsProps) {
  const metadataEntries = Object.entries(metadata ?? {});
  const attachmentRows = attachments ?? [];
  if (metadataEntries.length === 0 && attachmentRows.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      {metadataEntries.length > 0 ? (
        <dl
          className="price-note"
          style={{ display: "grid", gridTemplateColumns: "minmax(120px, auto) 1fr", gap: "4px 12px" }}
        >
          {metadataEntries.map(([key, value]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt style={{ fontWeight: 600 }}>{detailLabel(key)}</dt>
              <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{detailValue(value) || "—"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {attachmentRows.length > 0 ? (
        <div className="price-note" style={{ marginTop: 8 }}>
          <strong>Attachments</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
            {attachmentRows.map((attachment) => (
              <li key={attachment.id ?? attachment.storagePath}>
                {attachment.downloadUrl ? (
                  <a href={attachment.downloadUrl}>{attachment.fileName}</a>
                ) : (
                  attachment.fileName
                )}{" "}
                ({attachment.mimeType}, {attachmentSize(attachment.sizeBytes)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function LeadForm({
  endpoint = "/api/contact",
  title = "Contact",
  intro = "Tell us what you need and the team will follow up.",
  submitLabel = "Send request",
}: LeadFormProps) {
  const [state, setState] = useState<FormState>({ status: "idle", message: "" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    setState({ status: "submitting", message: "Sending..." });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        setState({
          status: "error",
          message: payload.error ?? "The request could not be sent.",
        });
        return;
      }

      form.reset();
      setState({
        status: "success",
        message: "Thanks. Your request was sent.",
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "The request could not be sent.",
      });
    }
  }

  return (
    // Plain wrapper, not <main>: the consuming app's page/layout owns the
    // <main> landmark, so this drop-in form never double-nests it.
    <div className="page">
      <section className="container" style={{ maxWidth: 720 }}>
        <header className="page-head">
          <span className="eyebrow">Get in touch</span>
          <h1>{title}</h1>
          <p className="lede">{intro}</p>
        </header>

        <form onSubmit={onSubmit} className="form panel pad">
          <input
            aria-hidden="true"
            autoComplete="off"
            name="website"
            tabIndex={-1}
            className="honeypot"
          />

          <div className="form-row">
            <label className="field">
              <span className="label">Name</span>
              <input
                className="input"
                name="name"
                autoComplete="name"
                maxLength={FIELD_LIMITS.name}
                required
              />
            </label>
            <label className="field">
              <span className="label">Email</span>
              <input
                className="input"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={FIELD_LIMITS.email}
                required
              />
            </label>
          </div>

          <div className="form-row">
            <label className="field">
              <span className="label">Company</span>
              <input
                className="input"
                name="company"
                autoComplete="organization"
                maxLength={FIELD_LIMITS.company}
              />
            </label>
            <label className="field">
              <span className="label">Phone</span>
              <input
                className="input"
                name="phone"
                autoComplete="tel"
                maxLength={FIELD_LIMITS.phone}
              />
            </label>
          </div>

          <label className="field">
            <span className="label">Office</span>
            <input
              className="input"
              name="office"
              autoComplete="street-address"
              maxLength={FIELD_LIMITS.office}
            />
          </label>

          <label className="field">
            <span className="label">Notes</span>
            <textarea
              className="input"
              name="notes"
              maxLength={FIELD_LIMITS.notes}
              rows={6}
            />
          </label>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            <button type="submit" className="btn" disabled={state.status === "submitting"}>
              {state.status === "submitting" ? "Sending..." : submitLabel}
            </button>
            {state.message ? (
              <p
                role={state.status === "error" ? "alert" : "status"}
                className={`form-msg ${state.status === "error" ? "error" : "success"}`}
              >
                {state.message}
              </p>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
