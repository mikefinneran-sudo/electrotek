// Stripe adapter — no SDK. When configured, calls the Stripe HTTP API via
// fetch(). When unconfigured, every call degrades gracefully to a
// setup-required/skipped result and NEVER throws. Mirrors the lead-capture
// email.ts posture (returning {ok:false, skipped:true} instead of throwing).
//
// Webhook signature verification uses Node crypto (no SDK): sign
// `${t}.${payload}` with STRIPE_WEBHOOK_SECRET and compare to the v1 sig in
// the Stripe-Signature header using timingSafeEqual.

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isDemo, logDemoSideEffect } from "@waltersignal/bananaforce-core/demo";
import { cardChargeAmount } from "./invoices";
import type { Invoice } from "./types";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

// Timestamp skew tolerance for webhook signature verification (5 minutes).
const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface StripeSetupRequiredResult {
  ok: false;
  setupRequired: true;
  skipped: true;
}

export interface StripeErrorResult {
  ok: false;
  error: string;
}

export interface PaymentIntentResult {
  ok: true;
  clientSecret: string;
  paymentIntentId: string;
}

export type CreatePaymentIntentResult =
  | PaymentIntentResult
  | StripeSetupRequiredResult
  | StripeErrorResult;

/**
 * Env-only check (no I/O). When false, every Stripe call returns a
 * setup-required stub rather than throwing.
 */
export function isStripeConfigured(): boolean {
  return !isDemo() && Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Whether the webhook secret is present. When false, the webhook handler
 * returns 503 setup-required without touching the DB.
 */
export function isStripeWebhookConfigured(): boolean {
  return !isDemo() && Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

function stripeAuthHeader(): string {
  // Secret key is guarded by isStripeConfigured() before any call site reaches
  // here — but throw defensively rather than send an empty auth header.
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe secret key is not configured.");
  return `Bearer ${key}`;
}

/**
 * Create a Stripe PaymentIntent for an invoice. Returns a setup-required stub
 * when Stripe is not configured. Never throws — callers receive a typed result
 * and handle accordingly.
 */
export async function createPaymentIntent(
  invoice: Pick<Invoice, "id" | "amount_due" | "currency"> &
    Partial<Pick<Invoice, "card_fee_passthrough">>,
): Promise<CreatePaymentIntentResult> {
  if (isDemo()) {
    logDemoSideEffect("stripe.payment-intent", { invoiceId: invoice.id });
    return { ok: false, setupRequired: true, skipped: true };
  }
  if (!isStripeConfigured()) {
    return { ok: false, setupRequired: true, skipped: true };
  }
  if (invoice.amount_due == null || invoice.amount_due <= 0) {
    return { ok: false, error: "Invoice has no amount due." };
  }

  const amountCents = Math.round(
    cardChargeAmount(invoice.amount_due, invoice.card_fee_passthrough === true) * 100,
  );
  const params = new URLSearchParams({
    amount: String(amountCents),
    currency: invoice.currency,
    "metadata[invoice_id]": invoice.id,
    "automatic_payment_methods[enabled]": "true",
  });

  try {
    const response = await fetch(`${STRIPE_API_BASE}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: stripeAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `invoice-${invoice.id}-${amountCents}`,
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: `Stripe ${response.status}: ${text.slice(0, 200)}` };
    }

    const data = (await response.json()) as {
      client_secret?: string;
      id?: string;
    };

    if (!data.client_secret || !data.id) {
      return { ok: false, error: "Stripe response missing client_secret or id." };
    }

    return {
      ok: true,
      clientSecret: data.client_secret,
      paymentIntentId: data.id,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Verify a Stripe webhook signature using the HMAC-SHA256 scheme. Implements
 * Stripe's Stripe-Signature header protocol: parse t= and v1= from the header,
 * compute HMAC-SHA256 of `${t}.${rawBody}` with STRIPE_WEBHOOK_SECRET, compare
 * to each v1 signature using timingSafeEqual. Rejects if the timestamp skew
 * exceeds WEBHOOK_TOLERANCE_SECONDS.
 *
 * Returns the parsed event object on success, or null on any failure (bad
 * signature, missing secret, parse error, timestamp skew). Never throws.
 */
export function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Record<string, unknown> | null {
  if (isDemo()) return null;
  if (!signatureHeader) return null;

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return null;

  // Parse the Stripe-Signature header: "t=...,v1=...,v1=..."
  const parts: Record<string, string[]> = {};
  for (const part of signatureHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!parts[key]) parts[key] = [];
    parts[key]!.push(val);
  }

  const timestamps = parts["t"];
  const v1Sigs = parts["v1"];
  if (!timestamps || timestamps.length === 0 || !v1Sigs || v1Sigs.length === 0) {
    return null;
  }

  const t = timestamps[0]!;
  const timestampSeconds = Number(t);
  if (!Number.isFinite(timestampSeconds)) return null;

  // Reject stale events (replay protection).
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS) {
    return null;
  }

  const signedPayload = `${t}.${rawBody}`;
  const expected = createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest();

  // Compare each v1 signature. Accept if any matches (Stripe may send multiple
  // during secret rotation).
  const verified = v1Sigs.some((v1) => {
    try {
      const candidate = Buffer.from(v1, "hex");
      if (candidate.length !== expected.length) return false;
      return timingSafeEqual(expected, candidate);
    } catch {
      return false;
    }
  });

  if (!verified) return null;

  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
}
