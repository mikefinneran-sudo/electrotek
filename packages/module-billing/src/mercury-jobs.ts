import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import {
  attachMercuryInvoice,
  getInvoice,
  isBillingConfigured,
  listInvoices,
  markMercuryInvoicePaid,
  markMercuryInvoiceVoid,
  recordMercuryPayment,
} from "./server";
import type { Invoice, InvoiceLineItem } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESULTS = 100;
const MAX_STRING = 500;

export interface MercuryCreateJobDetails {
  customer: { name: string; email: string };
  payerMemo: string;
  dueInDays: number;
}

export interface MercuryCreateJob extends MercuryCreateJobDetails {
  invoiceId: string;
  invoiceNumber: string;
  lineItems: InvoiceLineItem[];
}

export interface MercuryCheckJob {
  invoiceId: string;
  mercuryInvoiceId: string;
}

export interface MercuryJobHandlerSettings {
  resolveCreateJob: (
    invoice: Invoice,
  ) => Promise<MercuryCreateJobDetails | null> | MercuryCreateJobDetails | null;
  onCreated?: (invoice: Invoice) => Promise<void> | void;
  onPaid?: (invoice: Invoice) => Promise<void> | void;
}

type CreatedResult = {
  type: "created";
  invoiceId: string;
  mercuryInvoiceId: string;
  slug: string;
};

type StatusResult = {
  type: "status";
  invoiceId: string;
  status: "Unpaid" | "Processing" | "Paid" | "Cancelled";
  paidAt?: string;
};

type WorkerResult = CreatedResult | StatusResult;

function unauthorized(): Response {
  return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
}

function setupRequired(message: string): Response {
  return Response.json(
    { ok: false, setupRequired: true, error: message },
    { status: 503 },
  );
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

function secretAuthorized(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const actual = createHash("sha256").update(token).digest();
  const expected = createHash("sha256").update(secret).digest();
  return Boolean(token) && timingSafeEqual(actual, expected);
}

function authorized(request: Request): Response | null {
  const secret = process.env.MERCURY_WORKER_SECRET?.trim();
  if (!secret) return setupRequired("Mercury worker authentication is not configured.");
  return secretAuthorized(request, secret) ? null : unauthorized();
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING;
}

function parseWorkerResult(value: unknown): WorkerResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.type === "created") {
    if (!exactKeys(row, ["invoiceId", "mercuryInvoiceId", "slug", "type"])) return null;
    if (
      !UUID_RE.test(String(row.invoiceId)) ||
      !boundedString(row.mercuryInvoiceId) ||
      !boundedString(row.slug)
    ) {
      return null;
    }
    return {
      type: "created",
      invoiceId: String(row.invoiceId),
      mercuryInvoiceId: row.mercuryInvoiceId,
      slug: row.slug,
    };
  }

  if (row.type !== "status") return null;
  const keys = row.paidAt === undefined
    ? ["invoiceId", "status", "type"]
    : ["invoiceId", "paidAt", "status", "type"];
  if (!exactKeys(row, keys) || !UUID_RE.test(String(row.invoiceId))) return null;
  if (
    row.status !== "Unpaid" &&
    row.status !== "Processing" &&
    row.status !== "Paid" &&
    row.status !== "Cancelled"
  ) {
    return null;
  }
  if (
    row.paidAt !== undefined &&
    (!boundedString(row.paidAt) || !Number.isFinite(Date.parse(row.paidAt)))
  ) {
    return null;
  }
  return {
    type: "status",
    invoiceId: String(row.invoiceId),
    status: row.status,
    ...(typeof row.paidAt === "string" ? { paidAt: row.paidAt } : {}),
  };
}

async function readResults(request: Request): Promise<WorkerResult[] | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return null;
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (!exactKeys(row, ["results"]) || !Array.isArray(row.results)) return null;
  if (row.results.length === 0 || row.results.length > MAX_RESULTS) return null;
  const results = row.results.map(parseWorkerResult);
  return results.every((result): result is WorkerResult => result !== null)
    ? results
    : null;
}

/** Hooks are app side effects (CRM, contract stamps); one failing must not drop the batch. */
async function runHook(
  name: string,
  hook: ((invoice: Invoice) => Promise<void> | void) | undefined,
  invoice: Invoice,
): Promise<void> {
  try {
    await hook?.(invoice);
  } catch {
    console.warn(`[billing] Mercury ${name} hook failed:`, invoice.id);
  }
}

function validLineItems(items: InvoiceLineItem[] | null): items is InvoiceLineItem[] {
  return Boolean(
    items?.length &&
      items.every(
        (item) =>
          item.name.trim() &&
          Number.isFinite(item.quantity) &&
          item.quantity > 0 &&
          Number.isFinite(item.unitPrice) &&
          item.unitPrice > 0,
      ),
  );
}

export function createMercuryJobHandlers(settings: MercuryJobHandlerSettings): {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
} {
  return {
    async GET(request: Request): Promise<Response> {
      const authResponse = authorized(request);
      if (authResponse) return authResponse;
      if (!isBillingConfigured()) {
        return setupRequired("Mercury billing jobs are not configured.");
      }

      // Oldest first, so the longest-open invoices are always checked.
      const open = (await listInvoices({ status: "open" }))
        .filter((invoice) => invoice.processor === "mercury")
        .reverse();
      const check: MercuryCheckJob[] = open
        .filter(
          (invoice): invoice is Invoice & { mercury_invoice_id: string } =>
            Boolean(invoice.mercury_invoice_id),
        )
        .slice(0, 25)
        .map((invoice) => ({
          invoiceId: invoice.id,
          mercuryInvoiceId: invoice.mercury_invoice_id,
        }));

      const create: MercuryCreateJob[] = [];
      for (const invoice of open) {
        if (create.length === 25) break;
        if (invoice.mercury_invoice_id || !validLineItems(invoice.line_items)) continue;
        const detail = await settings.resolveCreateJob(invoice);
        if (!detail) continue;
        create.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          customer: detail.customer,
          lineItems: invoice.line_items,
          payerMemo: detail.payerMemo,
          dueInDays: detail.dueInDays,
        });
      }

      return Response.json({ create, check });
    },

    async POST(request: Request): Promise<Response> {
      const authResponse = authorized(request);
      if (authResponse) return authResponse;
      if (!isBillingConfigured()) {
        return setupRequired("Mercury billing jobs are not configured.");
      }

      const results = await readResults(request);
      if (!results) return badRequest("Invalid Mercury worker results.");

      const processed = { created: 0, paid: 0, voided: 0 };
      for (const result of results) {
        if (result.type === "created") {
          const attached = await attachMercuryInvoice(
            result.invoiceId,
            result.mercuryInvoiceId,
            result.slug,
          );
          if (!attached) continue;
          processed.created += 1;
          await runHook("onCreated", settings.onCreated, attached);
          continue;
        }

        if (result.status === "Unpaid" || result.status === "Processing") continue;
        if (result.status === "Cancelled") {
          if (await markMercuryInvoiceVoid(result.invoiceId)) processed.voided += 1;
          continue;
        }

        const invoice = await getInvoice(result.invoiceId);
        if (
          !invoice ||
          invoice.processor !== "mercury" ||
          invoice.status !== "open" ||
          !invoice.mercury_invoice_id ||
          invoice.amount_due == null ||
          invoice.amount_due <= 0
        ) {
          continue;
        }
        const paidAt = result.paidAt
          ? new Date(result.paidAt).toISOString()
          : new Date().toISOString();
        const payment = await recordMercuryPayment({
          invoice_id: invoice.id,
          amount: invoice.amount_due,
          paid_at: paidAt,
        });
        if (!payment) continue;
        const paid = await markMercuryInvoicePaid(invoice.id, paidAt);
        if (!paid) continue;
        processed.paid += 1;
        await runHook("onPaid", settings.onPaid, paid);
      }

      return Response.json({ ok: true, processed });
    },
  };
}
