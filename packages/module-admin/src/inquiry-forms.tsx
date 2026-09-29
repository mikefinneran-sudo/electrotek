"use client";

import { useState } from "react";

// Generic defaults so the template is vertical-neutral. Clients with a specific
// vertical pass their own list via createEventsPage(config, { eventTypes }).
export const DEFAULT_EVENT_TYPES = [
  "Wedding",
  "Corporate / Company event",
  "Birthday / Party",
  "Community event",
  "Holiday celebration",
  "Other",
];

export function EventRequestForm({
  eventTypes = DEFAULT_EVENT_TYPES,
}: {
  eventTypes?: string[];
}) {
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || ""),
      email: String(data.get("email") || ""),
      phone: String(data.get("phone") || ""),
      eventType: String(data.get("eventType") || ""),
      eventDate: String(data.get("eventDate") || ""),
      budget: String(data.get("budget") || ""),
      location: String(data.get("location") || ""),
      message: String(data.get("message") || ""),
    };
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong.");
      }
      form.reset();
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="callout success">
        <strong>Request received.</strong> We will be in touch shortly.
      </div>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "1rem" }}>
        <label className="field">
          <span className="label">Name</span>
          <input className="input" name="name" required />
        </label>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" name="email" type="email" required />
        </label>
        <label className="field">
          <span className="label">Phone</span>
          <input className="input" name="phone" />
        </label>
        <label className="field">
          <span className="label">Event type</span>
          <select className="input" name="eventType" defaultValue="">
            <option value="">Select…</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Event date</span>
          <input className="input" name="eventDate" type="date" />
        </label>
        <label className="field">
          <span className="label">Budget</span>
          <input className="input" name="budget" placeholder="Rough range" />
        </label>
      </div>
      <label className="field">
        <span className="label">Location</span>
        <input className="input" name="location" />
      </label>
      <label className="field">
        <span className="label">Message</span>
        <textarea className="input" name="message" rows={4} />
      </label>
      {error ? <p className="form-msg error">{error}</p> : null}
      <button type="submit" className="btn" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending…" : "Submit request"}
      </button>
    </form>
  );
}

export function WholesaleInquiryForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      company: String(data.get("company") || ""),
      contactName: String(data.get("contactName") || ""),
      email: String(data.get("email") || ""),
      phone: String(data.get("phone") || ""),
      businessType: String(data.get("businessType") || ""),
      taxExempt: data.get("taxExempt") === "on",
      message: String(data.get("message") || ""),
    };
    try {
      const res = await fetch("/api/wholesale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong.");
      }
      form.reset();
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="callout success">
        <strong>Inquiry received.</strong> Our team will follow up on wholesale access.
      </div>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "1rem" }}>
        <label className="field">
          <span className="label">Company</span>
          <input className="input" name="company" required />
        </label>
        <label className="field">
          <span className="label">Contact name</span>
          <input className="input" name="contactName" required />
        </label>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" name="email" type="email" required />
        </label>
        <label className="field">
          <span className="label">Phone</span>
          <input className="input" name="phone" />
        </label>
        <label className="field">
          <span className="label">Business type</span>
          <input className="input" name="businessType" placeholder="Retailer, tent, events…" />
        </label>
      </div>
      <label>
        <input type="checkbox" name="taxExempt" /> Tax-exempt / resale certificate on file
      </label>
      <label className="field">
        <span className="label">Message</span>
        <textarea className="input" name="message" rows={4} />
      </label>
      {error ? <p className="form-msg error">{error}</p> : null}
      <button type="submit" className="btn" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending…" : "Submit inquiry"}
      </button>
    </form>
  );
}
