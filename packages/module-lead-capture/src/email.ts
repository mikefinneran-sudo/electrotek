import { Resend } from "resend";
import type { LeadCaptureRecord } from "./index";

export interface LeadEmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface SendLeadNotificationResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

function envList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textValue(value: string): string {
  return value || "-";
}

function displayLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayMetadataValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(displayMetadataValue).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function displayBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildLeadNotificationEmail(lead: LeadCaptureRecord): LeadEmailContent {
  // Strip CR/LF so user-supplied fields can't inject email headers via subject.
  const headerSafe = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
  const who = lead.company
    ? `${headerSafe(lead.name)} (${headerSafe(lead.company)})`
    : headerSafe(lead.name);
  const subject = `New lead - ${who}`;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;width:140px;color:#6B7280;font-weight:600;vertical-align:top;">${escapeHtml(
      label,
    )}</td><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#111827;">${
      value || '<span style="color:#9CA3AF;">-</span>'
    }</td></tr>`;

  const metadataRows = Object.entries(lead.metadata ?? {}).map(([key, value]) => ({
    label: displayLabel(key),
    value: displayMetadataValue(value),
  }));
  const attachmentHtml = (lead.attachments ?? [])
    .map(
      (attachment) =>
        `<li>${escapeHtml(attachment.fileName)} <span style="color:#6B7280;">(${escapeHtml(
          attachment.mimeType,
        )}, ${escapeHtml(displayBytes(attachment.sizeBytes))})</span></li>`,
    )
    .join("");

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827;">
  <div style="border-bottom:3px solid #B45309;padding-bottom:12px;margin-bottom:24px;">
    <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#92400E;text-transform:uppercase;">BananaFORCE</div>
    <h1 style="font-size:22px;font-weight:700;margin:8px 0 0;color:#111827;">New lead</h1>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">
    ${row("Name", escapeHtml(lead.name))}
    ${row("Company", escapeHtml(lead.company))}
    ${row(
      "Email",
      lead.email
        ? `<a href="mailto:${escapeHtml(lead.email)}" style="color:#92400E;text-decoration:none;">${escapeHtml(
            lead.email,
          )}</a>`
        : "",
    )}
    ${row(
      "Phone",
      lead.phone
        ? `<a href="tel:${escapeHtml(lead.phone)}" style="color:#92400E;text-decoration:none;">${escapeHtml(
            lead.phone,
          )}</a>`
        : "",
    )}
    ${row("Office", escapeHtml(lead.office))}
    ${row("Notes", `<span style="white-space:pre-wrap;">${escapeHtml(lead.notes)}</span>`)}
    ${metadataRows
      .map(({ label, value }) => row(label, escapeHtml(value)))
      .join("")}
    ${
      attachmentHtml
        ? row("Attachments", `<ul style="margin:0;padding-left:18px;">${attachmentHtml}</ul>`)
        : ""
    }
  </table>
  <div style="margin-top:28px;padding-top:20px;border-top:1px solid #E5E7EB;font-size:12px;color:#6B7280;">Source: ${escapeHtml(
    lead.source,
  )}</div>
</div>`;

  const metadataText = metadataRows.map(({ label, value }) => `${label}: ${value || "-"}`);
  const attachmentText = (lead.attachments ?? []).map(
    (attachment) =>
      `- ${attachment.fileName} (${attachment.mimeType}, ${displayBytes(attachment.sizeBytes)})`,
  );
  const text = [
    "New lead",
    "",
    `Name: ${textValue(lead.name)}`,
    `Company: ${textValue(lead.company)}`,
    `Email: ${textValue(lead.email)}`,
    `Phone: ${textValue(lead.phone)}`,
    `Office: ${textValue(lead.office)}`,
    "",
    "Notes:",
    textValue(lead.notes),
    ...(metadataText.length > 0 ? ["", "Metadata:", ...metadataText] : []),
    ...(attachmentText.length > 0 ? ["", "Attachments:", ...attachmentText] : []),
    "",
    `Source: ${lead.source}`,
  ].join("\n");

  return { subject, html, text };
}

export async function sendLeadNotification(
  lead: LeadCaptureRecord,
): Promise<SendLeadNotificationResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: true, error: "RESEND_API_KEY not set" };
  }

  const to = envList(process.env.LEAD_NOTIFY_TO);
  const from = process.env.LEAD_NOTIFY_FROM ?? "BananaFORCE <onboarding@resend.dev>";

  if (to.length === 0) {
    return { ok: false, skipped: true, error: "LEAD_NOTIFY_TO not set" };
  }

  const resend = new Resend(apiKey);
  const { subject, html, text } = buildLeadNotificationEmail(lead);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      ...(lead.email ? { replyTo: lead.email } : {}),
      subject,
      html,
      text,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, id: data?.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
