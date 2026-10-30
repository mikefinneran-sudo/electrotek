import "server-only";

import { Resend } from "resend";
import { isDemo, logDemoSideEffect } from "@waltersignal/bananaforce-core/demo";

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
  /** True only when Resend explicitly rejected the request (429), so a retry cannot double-send. */
  retryable?: boolean;
}

export interface ExecutedContractEmailInput {
  to: string[];
  title: string;
  signerName: string;
  pdf: Uint8Array;
  filename: string;
}

export interface SignInviteEmailInput {
  to: string;
  signerName: string;
  signUrl: string;
  brandName: string;
  senderName?: string;
  title: string;
}

export interface SignReminderEmailInput
  extends Omit<SignInviteEmailInput, "signerName"> {
  signerName: string | null;
  touch: number;
}

export interface PaymentReceiptEmailInput {
  to: string;
  signerName: string;
  invoiceNumber: string;
  amount: number;
  paidAt: Date;
  brandName: string;
  senderName?: string;
  title: string;
}

export interface DepositDueEmailInput {
  to: string;
  signerName: string;
  payUrl: string;
  invoiceNumber: string;
  amountDue: number;
  /** Card charge, which exceeds amountDue when the card fee is passed through. */
  cardTotal: number;
  brandName: string;
  senderName?: string;
  title: string;
}

function firstName(full: string | null | undefined): string {
  const part = full?.trim().split(/\s+/)[0];
  return part || "there";
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
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
  if (isDemo()) {
    logDemoSideEffect("contract.portal-email");
    return { ok: false, skipped: true, error: "Email is not configured." };
  }
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
    if (error) return { ok: false, error: error.message, retryable: error.statusCode === 429 };
    return { ok: true, id: data?.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function signOff(senderName: string | undefined, brand: string): string[] {
  return senderName ? [senderName, brand] : [brand];
}

function paragraphs(lines: string[]): string {
  return lines
    .map((line) => `<p style="color:#444;line-height:1.5;margin:0 0 12px">${escapeHtml(line)}</p>`)
    .join("");
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#111827;color:#fff;padding:12px 16px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>`;
}

async function sendContractEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  idempotencyKey?: string,
): Promise<SendPortalLinkEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, skipped: true, error: "Email is not configured." };
  if (!to) return { ok: false, skipped: true, error: "No signer email." };

  const from = process.env.CONTRACT_EMAIL_FROM ?? "BananaFORCE <onboarding@resend.dev>";
  const replyTo = process.env.CONTRACT_NOTIFY_EMAIL?.trim() || undefined;
  try {
    const { data, error } = await new Resend(apiKey).emails.send(
      {
        from,
        to,
        ...(replyTo ? { replyTo } : {}),
        subject: headerSafe(subject),
        html,
        text,
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Ask the signer to review and e-sign an uploaded agreement. */
export async function sendSignInviteEmail(
  input: SignInviteEmailInput,
): Promise<SendPortalLinkEmailResult> {
  if (isDemo()) {
    logDemoSideEffect("contract.sign-invite-email");
    return { ok: false, skipped: true, error: "Email is not configured." };
  }
  const brand = input.brandName || "WalterSignal";
  const greeting = `Hi ${firstName(input.signerName)},`;
  const intro = `Your ${input.title} is ready for your signature. Open the link below to read the agreement and sign it online.`;
  const after = "Once the agreement is signed, a copy of the signed agreement and the deposit invoice follow by email.";
  const closing = signOff(input.senderName, brand);

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      ${paragraphs([greeting, intro])}
      ${button(input.signUrl, "Review and sign")}
      ${paragraphs([after])}
      <p style="color:#444;line-height:1.5">${closing.map(escapeHtml).join("<br>")}</p>
      <p style="color:#777;font-size:12px">If the button does not work, copy this link into your browser: ${escapeHtml(input.signUrl)}</p>
    </div>`;
  const text = [greeting, "", intro, "", input.signUrl, "", after, "", ...closing].join("\n");
  return sendContractEmail(input.to, `${input.title}: ready to sign`, html, text);
}

/** Remind an unsigned client using the same visual language as the invite. */
export async function sendSignReminderEmail(
  input: SignReminderEmailInput,
  idempotencyKey?: string,
): Promise<SendPortalLinkEmailResult> {
  if (isDemo()) {
    logDemoSideEffect("contract.sign-reminder-email");
    return { ok: false, skipped: true, error: "Email is not configured." };
  }
  const brand = input.brandName || "WalterSignal";
  const greeting = `Hi ${firstName(input.signerName)},`;
  const intro = `Just a reminder that your ${input.title} is ready for your signature.`;
  const action = "Open the secure link below to review and sign the agreement online.";
  const closing = signOff(input.senderName, brand);

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      ${paragraphs([greeting, intro, action])}
      ${button(input.signUrl, "Review and sign")}
      <p style="color:#444;line-height:1.5">${closing.map(escapeHtml).join("<br>")}</p>
      <p style="color:#777;font-size:12px">If the button does not work, copy this link into your browser: ${escapeHtml(input.signUrl)}</p>
    </div>`;
  const text = [greeting, "", intro, action, "", input.signUrl, "", ...closing].join("\n");
  return sendContractEmail(
    input.to,
    `Reminder: ${input.title} ready to sign`,
    html,
    text,
    idempotencyKey,
  );
}

/** Confirm a received payment; this email is the client's receipt. */
export async function sendPaymentReceiptEmail(
  input: PaymentReceiptEmailInput,
): Promise<SendPortalLinkEmailResult> {
  if (isDemo()) {
    logDemoSideEffect("contract.payment-receipt-email");
    return { ok: false, skipped: true, error: "Email is not configured." };
  }
  const brand = input.brandName || "WalterSignal";
  const paidOn = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "America/Indiana/Indianapolis",
  }).format(input.paidAt);
  const greeting = `Hi ${firstName(input.signerName)},`;
  const intro = `Payment of ${formatUsd(input.amount)} for invoice ${input.invoiceNumber} under the ${input.title} was received on ${paidOn}. Thank you.`;
  const note = "This email is your receipt. Please keep it for your records.";
  const closing = signOff(input.senderName, brand);

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      ${paragraphs([greeting, intro, note])}
      <p style="color:#444;line-height:1.5">${closing.map(escapeHtml).join("<br>")}</p>
    </div>`;
  const text = [greeting, "", intro, "", note, "", ...closing].join("\n");
  return sendContractEmail(input.to, `Payment received: invoice ${input.invoiceNumber}`, html, text);
}

/** Send the deposit invoice with bank and card payment options after signing. */
export async function sendDepositDueEmail(
  input: DepositDueEmailInput,
): Promise<SendPortalLinkEmailResult> {
  if (isDemo()) {
    logDemoSideEffect("contract.deposit-email");
    return { ok: false, skipped: true, error: "Email is not configured." };
  }
  const brand = input.brandName || "WalterSignal";
  const amount = formatUsd(input.amountDue);
  const cardAmount = formatUsd(input.cardTotal);
  const feeApplies = input.cardTotal > input.amountDue;
  const bankDetails = process.env.CONTRACT_PAYMENT_INSTRUCTIONS?.trim();

  const greeting = `Hi ${firstName(input.signerName)},`;
  const intro = `Thank you for signing the ${input.title}. Invoice ${input.invoiceNumber} for the deposit of ${amount} is below, due within 15 days.`;
  const bankHeading = `Pay ${amount} by ACH or wire transfer, at no fee:`;
  const bankLines = bankDetails
    ? bankDetails.split(/\r?\n/)
    : ["Reply to this email and the bank details for ACH or wire follow."];
  const cardLine = feeApplies
    ? `Or pay ${cardAmount} by card. The card total includes the 2.9% + $0.30 processing fee set out in the agreement.`
    : `Or pay ${cardAmount} by card, with no processing fee.`;
  const closing = signOff(input.senderName, brand);

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      ${paragraphs([greeting, intro])}
      <p style="color:#444;line-height:1.5;margin:16px 0 4px"><strong>${escapeHtml(bankHeading)}</strong></p>
      <p style="color:#444;line-height:1.5;margin:0 0 12px;font-family:ui-monospace,monospace">${bankLines.map(escapeHtml).join("<br>")}</p>
      ${paragraphs([cardLine])}
      ${button(input.payUrl, `Pay ${cardAmount} by card`)}
      <p style="color:#444;line-height:1.5">${closing.map(escapeHtml).join("<br>")}</p>
      <p style="color:#777;font-size:12px">If the button does not work, copy this link into your browser: ${escapeHtml(input.payUrl)}</p>
    </div>`;
  const text = [
    greeting,
    "",
    intro,
    "",
    bankHeading,
    ...bankLines,
    "",
    cardLine,
    input.payUrl,
    "",
    ...closing,
  ].join("\n");
  return sendContractEmail(
    input.to,
    `Deposit invoice ${input.invoiceNumber}: ${amount}`,
    html,
    text,
  );
}

/** Send the signer and contract mailbox a copy of an executed uploaded PDF. */
export async function sendExecutedContractEmail(
  input: ExecutedContractEmailInput,
): Promise<SendPortalLinkEmailResult> {
  if (isDemo()) {
    logDemoSideEffect("contract.executed-email");
    return { ok: false, skipped: true, error: "Email is not configured." };
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, skipped: true, error: "Email is not configured." };
  if (input.to.length === 0) return { ok: false, skipped: true, error: "No recipients." };

  const from = process.env.CONTRACT_EMAIL_FROM ?? "BananaFORCE <onboarding@resend.dev>";
  const resend = new Resend(apiKey);
  const title = input.title || "Agreement";
  const subject = headerSafe(`Executed: ${title}`);
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="margin:0 0 12px">Your executed agreement</h2>
      <p style="color:#444;line-height:1.5">
        <strong>${escapeHtml(title)}</strong> was signed by ${escapeHtml(input.signerName)}.
        The executed PDF is attached for your records.
      </p>
    </div>`;
  const text = [
    "Your executed agreement",
    "",
    `${title} was signed by ${input.signerName}.`,
    "The executed PDF is attached for your records.",
  ].join("\n");

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject,
      html,
      text,
      attachments: [
        {
          content: Buffer.from(input.pdf),
          filename: headerSafe(input.filename) || "Executed-Agreement.pdf",
          contentType: "application/pdf",
        },
      ],
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
