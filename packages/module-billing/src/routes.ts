// Route-handler factories for the billing module. Three surfaces, three gates:
//
// 1. /api/billing — createBillingRouteHandlers({ authorize })
//    Staff console (deny-by-default authorize gate). Also handles a client
//    pay-link sub-path: if a signed pay-link token is present, the client may
//    GET its own invoice (client projection only) and request a payment intent.
//
// 2. /api/stripe-webhook — createStripeWebhookHandler()
//    Signature-verified. Reads the raw body, verifies the Stripe HMAC-SHA256
//    signature BEFORE any DB work. Rejects 400 on bad/missing sig, 503 when
//    the webhook secret is absent. NOT staff-authorized, NOT token-gated — the
//    signature IS the gate.
//
// 3. Client pay-link (sub-path of /api/billing, gated by verifyPayLinkToken).
//    Only allows GET of own invoice (client projection) and POST to create a
//    payment intent for that specific invoice.

import "server-only";
import { isDemo, logDemoSideEffect } from "@waltersignal/bananaforce-core/demo";
import type { AuditActor } from "@waltersignal/bananaforce-data-supabase/audit";
import {
  createInvoice,
  getClientInvoice,
  getInvoice,
  isBillingConfigured,
  listInvoices,
  markInvoicePaid,
  patchInvoice,
  recordPayment,
  recordStripeRefund,
  type InvoiceInput,
} from "./server";
import { createPaymentIntent, isStripeWebhookConfigured, verifyStripeWebhook } from "./stripe";
import { createPayLinkToken, isBillingTokenConfigured, MAX_TOKEN_LENGTH, verifyPayLinkToken } from "./tokens";
import { payPageUrl } from "./pay-page-url";
import type { Invoice, InvoiceStatus } from "./types";
import { INVOICE_STATUSES } from "./types";

async function enqueueInvoiceOpened(invoice: Invoice): Promise<void> {
  if (invoice.status !== "open") return;
  try {
    const { enqueueLedgerEvent } = await import(
      "@waltersignal/bananaforce-module-accounting/events"
    );
    await enqueueLedgerEvent({
      eventType: "invoice.opened",
      sourceModule: "billing",
      sourceId: invoice.id,
      payload: {
        invoice_id: invoice.id,
        amount: invoice.amount_due ?? 0,
        currency: invoice.currency,
        invoice_number: invoice.number,
      },
    });
  } catch {
    // Accounting module optional — never fail billing routes.
  }
}

// --- string length caps -------------------------------------------------------

const MAX_STRING = 500;
const MAX_NUMBER = 1e12; // $1 trillion — sanity upper bound on amounts

// --- shared helpers -----------------------------------------------------------

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function unauthorized(): Response {
  return json({ ok: false, error: "Unauthorized." }, { status: 401 });
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, { status: 400 });
}

function setupRequired(): Response {
  return json(
    {
      ok: false,
      setupRequired: true,
      error: "Billing is not configured. Contact your administrator.",
    },
    { status: 503 },
  );
}

function notFound(): Response {
  return json({ ok: false, error: "Not found." }, { status: 404 });
}

// UUID pattern — reused for invoice, inspection, and customer id validation.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Stripe PaymentIntent ids look like `pi_3Nxxxx...`. Bound the shape before the
// value reaches the DB from a (verified) webhook payload.
const STRIPE_PI_RE = /^pi_[A-Za-z0-9]{1,60}$/;
const STRIPE_REFUND_RE = /^re_[A-Za-z0-9]{1,60}$/;
const STRIPE_API_BASE = "https://api.stripe.com/v1";

async function lookupStripePaymentIntent(
  paymentIntentId: string,
): Promise<{ invoiceId: string | null; currency: string | null }> {
  if (isDemo()) {
    logDemoSideEffect("stripe.payment-intent-lookup", { paymentIntentId });
    return { invoiceId: null, currency: null };
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret || !STRIPE_PI_RE.test(paymentIntentId)) {
    return { invoiceId: null, currency: null };
  }

  try {
    const response = await fetch(
      `${STRIPE_API_BASE}/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      {
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
        },
      },
    );

    if (!response.ok) {
      return { invoiceId: null, currency: null };
    }

    const body = (await response.json()) as {
      metadata?: Record<string, unknown>;
      currency?: unknown;
    };
    const invoiceId =
      typeof body.metadata?.invoice_id === "string" && isUUID(body.metadata.invoice_id)
        ? body.metadata.invoice_id
        : null;
    const currency =
      typeof body.currency === "string" ? body.currency.toLowerCase() : null;

    return { invoiceId, currency };
  } catch {
    return { invoiceId: null, currency: null };
  }
}

const STRIPE_CHARGE_RE = /^ch_[A-Za-z0-9]{1,60}$/;

// Since API version 2022-11-15, Charge.refunds is not expanded by default, so a
// charge.refunded webhook usually carries no refund list. Fetch it instead.
async function listStripeRefundsForCharge(
  chargeId: string,
): Promise<Record<string, unknown>[] | null> {
  if (isDemo()) {
    logDemoSideEffect("stripe.refund-lookup", { chargeId });
    return null;
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret || !STRIPE_CHARGE_RE.test(chargeId)) return null;

  try {
    const response = await fetch(
      `${STRIPE_API_BASE}/refunds?charge=${encodeURIComponent(chargeId)}&limit=100`,
      { headers: { Authorization: `Bearer ${stripeSecret}` } },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: unknown };
    return Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  }
  const formData = await request.formData().catch(() => undefined);
  if (!formData) return {};
  return Object.fromEntries(formData.entries());
}

function capString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).slice(0, MAX_STRING);
  return s || null;
}

function capNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_NUMBER) return null;
  return n;
}

function pickInvoiceInput(body: Record<string, unknown>): InvoiceInput {
  const input: InvoiceInput = {};

  const status = body.status;
  if (status != null) {
    input.status = INVOICE_STATUSES.includes(status as InvoiceStatus)
      ? (status as InvoiceStatus)
      : undefined;
  }

  if ("number" in body) input.number = capString(body.number) ?? undefined;
  if ("amount_due" in body) input.amount_due = capNumber(body.amount_due);
  if ("currency" in body) input.currency = capString(body.currency) ?? "usd";
  if ("due_date" in body) input.due_date = capString(body.due_date);
  if ("stripe_invoice_id" in body) input.stripe_invoice_id = capString(body.stripe_invoice_id);

  if ("inspection_id" in body) {
    const inspId = body.inspection_id;
    input.inspection_id = isUUID(inspId) ? inspId : null;
  }

  if ("customer_id" in body) {
    const customerId = body.customer_id;
    input.customer_id = isUUID(customerId) ? customerId : null;
  }

  return input;
}

// --- token extraction ---------------------------------------------------------

function extractToken(request: Request): string | null {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken.slice(0, MAX_TOKEN_LENGTH);

  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length, "Bearer ".length + MAX_TOKEN_LENGTH);
  }

  return null;
}

// === Billing route handlers ================================================

export interface BillingRouteOptions {
  /**
   * Called before EVERY staff handler. Return true to allow. When absent, all
   * staff requests are denied (401) — deny-by-default.
   */
  authorize?: (
    request: Request,
    method: "GET" | "POST" | "PATCH",
  ) => boolean | Promise<boolean>;
  getActor?: (request: Request) => AuditActor | null | Promise<AuditActor | null>;
}

export function createBillingRouteHandlers(options: BillingRouteOptions) {
  const authorized = (request: Request, method: "GET" | "POST" | "PATCH") =>
    options.authorize
      ? Promise.resolve(options.authorize(request, method))
      : Promise.resolve(false);
  const actorFor = (request: Request) =>
    options.getActor ? Promise.resolve(options.getActor(request)) : Promise.resolve(null);

  // --- Client pay-link handlers (token-gated, not staff-authorized) ----------

  async function handleClientGet(
    request: Request,
    invoiceId: string,
  ): Promise<Response> {
    if (!isBillingConfigured()) return setupRequired();

    const invoice = await getClientInvoice(invoiceId);
    if (!invoice) return notFound();

    return json({ ok: true, invoice });
  }

  async function handleClientPaymentIntent(
    _request: Request,
    invoiceId: string,
  ): Promise<Response> {
    if (!isBillingConfigured()) return setupRequired();

    // Fetch full invoice to get amount_due + currency for Stripe.
    const invoice = await getInvoice(invoiceId);
    if (!invoice) return notFound();

    const result = await createPaymentIntent(invoice);
    if (!result.ok) {
      if ("setupRequired" in result) return setupRequired();
      return json({ ok: false, error: result.error }, { status: 502 });
    }

    return json({ ok: true, clientSecret: result.clientSecret });
  }

  // --- Staff handlers --------------------------------------------------------

  async function GET(request: Request): Promise<Response> {
    // Try token-gated client path first.
    const rawToken = extractToken(request);
    if (rawToken) {
      const verified = await verifyPayLinkToken(rawToken);
      if (!verified) return unauthorized();

      const url = new URL(request.url);
      const idParam = url.searchParams.get("id");
      // Client can only GET their specific invoice (matched by token).
      if (!isUUID(idParam) || idParam !== verified.invoiceId) {
        return unauthorized();
      }
      return handleClientGet(request, verified.invoiceId);
    }

    // Staff path.
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isBillingConfigured()) return setupRequired();

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (id) {
      if (!isUUID(id)) return badRequest("Invalid invoice id.");
      const invoice = await getInvoice(id);
      if (!invoice) return notFound();
      return json({ ok: true, invoice });
    }

    // List with optional filters.
    const statusParam = url.searchParams.get("status");
    const inspectionId = url.searchParams.get("inspection_id");
    const customerId = url.searchParams.get("customer_id");

    const status = INVOICE_STATUSES.includes(statusParam as InvoiceStatus)
      ? (statusParam as InvoiceStatus)
      : undefined;
    const filter = {
      ...(status ? { status } : {}),
      ...(inspectionId && isUUID(inspectionId) ? { inspection_id: inspectionId } : {}),
      ...(customerId && isUUID(customerId) ? { customer_id: customerId } : {}),
    };

    const invoices = await listInvoices(filter);
    return json({ ok: true, invoices });
  }

  async function POST(request: Request): Promise<Response> {
    // Try token-gated client pay-link path.
    const rawToken = extractToken(request);
    if (rawToken) {
      const verified = await verifyPayLinkToken(rawToken);
      if (!verified) return unauthorized();

      const url = new URL(request.url);
      const action = url.searchParams.get("action");

      if (action === "payment-intent") {
        const idParam = url.searchParams.get("id");
        if (!isUUID(idParam) || idParam !== verified.invoiceId) {
          return unauthorized();
        }
        return handleClientPaymentIntent(request, verified.invoiceId);
      }

      // Client token holders may not create invoices or take other POST actions.
      return unauthorized();
    }

    // Staff path.
    if (!(await authorized(request, "POST"))) return unauthorized();
    if (!isBillingConfigured()) return setupRequired();

    const body = await readBody(request);
    const action = typeof body.action === "string" ? body.action : null;

    if (action === "payment-intent") {
      const id = typeof body.id === "string" ? body.id : null;
      if (!id || !isUUID(id)) return badRequest("An invoice id is required.");

      const invoice = await getInvoice(id);
      if (!invoice) return notFound();

      const result = await createPaymentIntent(invoice);
      if (!result.ok) {
        if ("setupRequired" in result) return setupRequired();
        return json({ ok: false, error: result.error }, { status: 502 });
      }
      return json({ ok: true, clientSecret: result.clientSecret });
    }

    if (action === "pay-link") {
      const id = typeof body.id === "string" ? body.id : null;
      if (!id || !isUUID(id)) return badRequest("An invoice id is required.");
      if (!isBillingTokenConfigured()) return setupRequired();
      const invoice = await getInvoice(id);
      if (!invoice) return notFound();
      try {
        const token = await createPayLinkToken(id);
        const origin = new URL(request.url).origin;
        const url = payPageUrl(origin, token, id);
        return json({ ok: true, url, token });
      } catch (err) {
        return json(
          { ok: false, error: err instanceof Error ? err.message : "Could not create pay link." },
          { status: 500 },
        );
      }
    }

    // Create a new invoice.
    const input = pickInvoiceInput(body);
    if (!input.number) {
      return badRequest("An invoice number is required.");
    }
    if (input.amount_due == null) {
      return badRequest("amount_due is required.");
    }

    const invoice = await createInvoice(input, await actorFor(request));
    if (!invoice) {
      return json({ ok: false, error: "Could not create the invoice." }, { status: 500 });
    }

    if (invoice.status === "open") {
      await enqueueInvoiceOpened(invoice);
    }

    return json({ ok: true, id: invoice.id, invoice }, { status: 201 });
  }

  async function PATCH(request: Request): Promise<Response> {
    if (!(await authorized(request, "PATCH"))) return unauthorized();
    if (!isBillingConfigured()) return setupRequired();

    const body = await readBody(request);
    const id = typeof body.id === "string" ? body.id : null;
    if (!id || !isUUID(id)) return badRequest("An invoice id is required.");

    const input = pickInvoiceInput(body);
    const before = await getInvoice(id);
    const invoice = await patchInvoice(
      id,
      {
        status: input.status,
        amount_due: input.amount_due ?? undefined,
        due_date: input.due_date,
        stripe_invoice_id: input.stripe_invoice_id,
        customer_id: input.customer_id,
      },
      await actorFor(request),
    );

    if (!invoice) {
      return json({ ok: false, error: "Could not update the invoice." }, { status: 404 });
    }

    if (invoice.status === "open" && before?.status !== "open") {
      await enqueueInvoiceOpened(invoice);
    }

    return json({ ok: true, id: invoice.id, invoice });
  }

  return { GET, POST, PATCH };
}

// === Stripe webhook handler ================================================

/**
 * Factory for the Stripe webhook route. The signature IS the gate — this route
 * is not staff-authorized and not token-gated.
 *
 * The consuming app re-exports this as `export const { POST } = createStripeWebhookHandler()`.
 */
export function createStripeWebhookHandler() {
  async function POST(request: Request): Promise<Response> {
    // Degrade to 503 when the webhook secret is absent — the signature check
    // cannot proceed without it. A 503 tells Stripe to retry later.
    if (!isStripeWebhookConfigured()) {
      return json(
        {
          ok: false,
          setupRequired: true,
          error: "Webhook endpoint is not configured. Contact your administrator.",
        },
        { status: 503 },
      );
    }

    // Read the raw body as text BEFORE any other work — the signature covers the
    // exact bytes sent by Stripe.
    const rawBody = await request.text().catch(() => "");
    const sigHeader = request.headers.get("stripe-signature");

    // Verify the signature BEFORE any DB work. If the signature is invalid or
    // missing, reject with 400 — do not process.
    const event = verifyStripeWebhook(rawBody, sigHeader);
    if (!event) {
      return json({ ok: false, error: "Invalid or missing webhook signature." }, { status: 400 });
    }

    // Guard DB work with the service-role check.
    if (!isBillingConfigured()) {
      return json(
        {
          ok: false,
          setupRequired: true,
          error: "Billing is not configured. Contact your administrator.",
        },
        { status: 503 },
      );
    }

    const eventType = typeof event.type === "string" ? event.type : "";

    if (eventType === "payment_intent.succeeded") {
      const eventData = (event.data ?? {}) as Record<string, unknown>;
      const piData = (eventData.object ?? {}) as Record<string, unknown>;

      const paymentIntentId = typeof piData.id === "string" ? piData.id : null;
      const metadata = (piData.metadata ?? {}) as Record<string, unknown>;
      const invoiceId =
        typeof metadata.invoice_id === "string" ? metadata.invoice_id : null;

      // Validate the payment-intent id shape before it reaches the DB.
      if (
        paymentIntentId &&
        STRIPE_PI_RE.test(paymentIntentId) &&
        invoiceId &&
        isUUID(invoiceId)
      ) {
        const amount = typeof piData.amount === "number" ? piData.amount / 100 : 0;

        // Idempotent on stripe_payment_intent_id. Only mark the invoice paid if
        // the payment row actually persisted — otherwise the invoice could read
        // 'paid' with no backing payment.
        const payment = await recordPayment({
          invoice_id: invoiceId,
          amount,
          status: "succeeded",
          stripe_payment_intent_id: paymentIntentId,
          paid_at: new Date().toISOString(),
        });

        if (!payment) {
          // DB write failed — return 500 so Stripe retries the delivery.
          return json(
            { ok: false, error: "Could not record the payment." },
            { status: 500 },
          );
        }

        const invoice = await markInvoicePaid(invoiceId);
        if (!invoice) {
          return json(
            { ok: false, error: "Could not update the invoice." },
            { status: 500 },
          );
        }

        try {
          const { enqueueLedgerEvent } = await import(
            "@waltersignal/bananaforce-module-accounting/events"
          );
          await enqueueLedgerEvent({
            eventType: "payment.succeeded",
            sourceModule: "billing",
            sourceId: payment.id,
            payload: {
              invoice_id: invoiceId,
              payment_id: payment.id,
              amount,
              currency: invoice.currency,
              invoice_number: invoice.number,
            },
          });
        } catch {
          // Accounting module optional — never fail the webhook.
        }
      }
    }

    // charge.refunded carries the Charge; charge.refund.updated carries one
    // Refund, and is how a refund that was pending at charge.refunded time
    // arrives once it settles. Both record through the same refund-id key.
    if (eventType === "charge.refunded" || eventType === "charge.refund.updated") {
      const eventData = (event.data ?? {}) as Record<string, unknown>;
      const charge = (eventData.object ?? {}) as Record<string, unknown>;
      const isRefundObject = eventType === "charge.refund.updated";
      const paymentIntentId =
        typeof charge.payment_intent === "string" ? charge.payment_intent : null;

      if (paymentIntentId && STRIPE_PI_RE.test(paymentIntentId)) {
        const refundList = (charge.refunds ?? {}) as Record<string, unknown>;
        const rawRefunds = isRefundObject
          ? [charge]
          : Array.isArray(refundList.data)
          ? (refundList.data as Record<string, unknown>[])
          : typeof charge.id === "string"
            ? await listStripeRefundsForCharge(charge.id)
            : null;
        if (rawRefunds === null) {
          // Refunds could not be read; fail so Stripe redelivers.
          return json(
            { ok: false, error: "Could not read the refunds for this charge." },
            { status: 500 },
          );
        }
        const refunds = rawRefunds.filter((refund) => {
          const status = typeof refund.status === "string" ? refund.status : null;
          return (
            typeof refund.id === "string" &&
            STRIPE_REFUND_RE.test(refund.id) &&
            typeof refund.amount === "number" &&
            refund.amount > 0 &&
            // Only settled refunds are booked. A pending one is recorded when
            // charge.refund.updated reports it succeeded; a failed one never is.
            status === "succeeded"
          );
        });

        const metadata = (charge.metadata ?? {}) as Record<string, unknown>;
        let invoiceId =
          typeof metadata.invoice_id === "string" && isUUID(metadata.invoice_id)
            ? metadata.invoice_id
            : null;
        let currency =
          typeof charge.currency === "string" ? charge.currency.toLowerCase() : null;

        if (!invoiceId || !currency) {
          const lookedUp = await lookupStripePaymentIntent(paymentIntentId);
          if (!invoiceId) invoiceId = lookedUp.invoiceId;
          if (!currency) currency = lookedUp.currency;
        }

        // A charge with no BananaFORCE invoice is not ours to record; retrying
        // would never change that, so acknowledge it.
        if (!invoiceId || refunds.length === 0) {
          return json({ ok: true, received: true });
        }

        // Stripe's Charge.amount_refunded is cumulative. Each Refund object has
        // its own stable id and amount, and Stripe keeps the ten most recent on
        // the Charge, so key and record each delta by refund id instead of ever
        // replaying the cumulative amount. Docs: https://docs.stripe.com/api/refunds
        for (const refund of refunds) {
          const refundId = refund.id as string;
          const amount = -Math.abs((refund.amount as number) / 100);
          const created =
            typeof refund.created === "number"
              ? new Date(refund.created * 1000).toISOString()
              : new Date().toISOString();
          const recorded = await recordStripeRefund({
            invoice_id: invoiceId,
            amount,
            stripe_refund_id: refundId,
            paid_at: created,
          });

          if (!recorded) {
            return json(
              { ok: false, error: "Could not record the payment." },
              { status: 500 },
            );
          }

          try {
            const { enqueueLedgerEvent } = await import(
              "@waltersignal/bananaforce-module-accounting/events"
            );
            await enqueueLedgerEvent({
              eventType: "payment.refunded",
              sourceModule: "billing",
              sourceId: recorded.payment.id,
              payload: {
                amount,
                currency: currency ?? "usd",
                invoice_id: invoiceId,
                payment_id: recorded.payment.id,
                description: `Stripe refund ${refundId} for ${paymentIntentId}`,
              },
            });
          } catch {
            // Accounting module optional — never fail the webhook.
          }
        }
      }
    }

    // Acknowledge the event. Unknown event types are intentionally ignored and
    // acknowledged — this is Stripe's recommended posture for forward compat.
    return json({ ok: true, received: true });
  }

  return { POST };
}

// Re-export token configured check so the app can surface a setup hint.
export { isBillingTokenConfigured };
