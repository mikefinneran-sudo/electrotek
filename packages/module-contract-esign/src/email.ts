import "server-only";

import { Resend } from "resend";

export interface PortalLinkEmailInput {
  to: string | null;
  company: string | null;
  portalUrl: string;
  providerName: string;
}

export interface SendPortalLinkEmailResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  error?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function sendPortalLinkEmail(
  input: PortalLinkEmailInput,
): Promise<SendPortalLinkEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, skipped: true, error: "Email is not configured." };
  if (!input.to) return { ok: false, skipped: true, error: "No client email on inspection." };

  const from = process.env.CONTRACT_EMAIL_FROM ?? "BananaFORCE <onboarding@resend.dev>";
  const resend = new Resend(apiKey);
  const company = input.company || "your account";
  const providerName = input.providerName || "our team";
  const subject = `Your ${headerSafe(providerName)} client portal`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="margin:0 0 12px">Your client portal is ready</h2>
      <p style="color:#444;line-height:1.5">
        Thanks for signing the agreement for <strong>${escapeHtml(company)}</strong>.
        Use the secure link below to view your client portal and report any issues.
      </p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(input.portalUrl)}" style="background:#111827;color:#fff;padding:12px 16px;border-radius:6px;text-decoration:none;display:inline-block">
          Open client portal
        </a>
      </p>
      <p style="color:#777;font-size:12px">If the button does not work, copy and paste this link: ${escapeHtml(input.portalUrl)}</p>
    </div>`;
  const text = [
    "Your client portal is ready",
    "",
    `Thanks for signing the agreement for ${company}.`,
    "Use this secure link to view your client portal and report any issues:",
    input.portalUrl,
  ].join("\n");

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject,
      html,
      text,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
