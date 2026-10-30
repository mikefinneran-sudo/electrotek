// Service-role data access for the billing module. invoices and payments are
// staff/service-role managed (no anon/authenticated RLS policies), so all reads
// and writes here use the service-role key, which bypasses RLS. Guard every call
// with isBillingConfigured() and degrade gracefully when env is missing.

import "server-only";
import { recordAudit, type AuditActor } from "@waltersignal/bananaforce-data-supabase/audit";
import { fetchAllRows } from "@waltersignal/bananaforce-data-supabase/pagination";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import type {
  ClientInvoice,
  Invoice,
  InvoiceLineItem,
  InvoiceProcessor,
  InvoiceStatus,
  Payment,
  PaymentStatus,
} from "./types";
import { INVOICE_STATUSES, PAYMENT_STATUSES } from "./types";
import { cardChargeAmount } from "./invoices";

type BillingRow = Record<string, unknown>;

// --- writable field allow-lists -------------------------------------------

export interface InvoiceInput {
  inspection_id?: string | null;
  customer_id?: string | null;
  contract_id?: string | null;
  card_fee_passthrough?: boolean;
  number?: string;
  amount_due?: number | null;
  currency?: string;
  status?: InvoiceStatus;
  processor?: InvoiceProcessor | null;
  line_items?: InvoiceLineItem[] | null;
  stripe_invoice_id?: string | null;
  mercury_invoice_id?: string | null;
  mercury_invoice_slug?: string | null;
  due_date?: string | null;
  paid_at?: string | null;
}

const WRITABLE_INVOICE_FIELDS: readonly (keyof InvoiceInput)[] = [
  "inspection_id",
  "customer_id",
  "contract_id",
  "card_fee_passthrough",
  "number",
  "amount_due",
  "currency",
  "status",
  "processor",
  "line_items",
  "stripe_invoice_id",
  "mercury_invoice_id",
  "mercury_invoice_slug",
  "due_date",
  "paid_at",
];

export interface PaymentInput {
  invoice_id: string;
  amount: number;
  status?: PaymentStatus;
  stripe_payment_intent_id?: string | null;
  paid_at?: string | null;
}

export interface StripeRefundInput {
  invoice_id: string;
  amount: number;
  stripe_refund_id: string;
  paid_at: string;
}

export interface RecordStripeRefundResult {
  payment: Payment;
  created: boolean;
}

// --- helpers ---------------------------------------------------------------

const MODULE_LABEL = "Billing";

const warn = (operation: string, error: unknown) =>
  warnSupabase(MODULE_LABEL, operation, error);

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function statusOrDraft(value: unknown): InvoiceStatus {
  return INVOICE_STATUSES.includes(value as InvoiceStatus)
    ? (value as InvoiceStatus)
    : "draft";
}

function paymentStatusOrPending(value: unknown): PaymentStatus {
  return PAYMENT_STATUSES.includes(value as PaymentStatus)
    ? (value as PaymentStatus)
    : "pending";
}

function processorOrNull(value: unknown): InvoiceProcessor | null {
  return value === "stripe" || value === "mercury" ? value : null;
}

function lineItemsOrNull(value: unknown): InvoiceLineItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: InvoiceLineItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const name = stringOrNull(row.name)?.trim();
    const quantity = numberOrNull(row.quantity);
    const unitPrice = numberOrNull(row.unitPrice);
    if (!name || quantity == null || unitPrice == null) return null;
    items.push({ name, quantity, unitPrice });
  }
  return items;
}

/**
 * Env-only check (no I/O). When false, every service function degrades to
 * empty/null rather than throwing — mirrors isQuoteEngineConfigured posture.
 */
export function isBillingConfigured(): boolean {
  return isServiceRoleConfigured();
}

const getServiceClient = (operation: string) =>
  getServiceClientOrNull(MODULE_LABEL, operation);

function invoiceFromRow(row: BillingRow): Invoice {
  return {
    id: stringOrNull(row.id) ?? "",
    inspection_id: stringOrNull(row.inspection_id),
    customer_id: stringOrNull(row.customer_id),
    contract_id: stringOrNull(row.contract_id),
    card_fee_passthrough: row.card_fee_passthrough === true,
    number: stringOrNull(row.number) ?? "",
    amount_due: numberOrNull(row.amount_due),
    currency: stringOrNull(row.currency) ?? "usd",
    status: statusOrDraft(row.status),
    processor: processorOrNull(row.processor),
    line_items: lineItemsOrNull(row.line_items),
    stripe_invoice_id: stringOrNull(row.stripe_invoice_id),
    mercury_invoice_id: stringOrNull(row.mercury_invoice_id),
    mercury_invoice_slug: stringOrNull(row.mercury_invoice_slug),
    due_date: stringOrNull(row.due_date),
    paid_at: stringOrNull(row.paid_at),
    created_at: stringOrNull(row.created_at) ?? undefined,
    updated_at: stringOrNull(row.updated_at) ?? undefined,
  };
}

function paymentFromRow(row: BillingRow): Payment {
  return {
    id: stringOrNull(row.id) ?? "",
    invoice_id: stringOrNull(row.invoice_id) ?? "",
    amount: numberOrNull(row.amount) ?? 0,
    status: paymentStatusOrPending(row.status),
    stripe_payment_intent_id: stringOrNull(row.stripe_payment_intent_id),
    paid_at: stringOrNull(row.paid_at),
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

function pickWritableInvoiceFields(input: InvoiceInput): BillingRow {
  const patch: BillingRow = {};
  for (const field of WRITABLE_INVOICE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

// --- invoices ---------------------------------------------------------------

export async function createInvoice(
  input: InvoiceInput,
  actor?: AuditActor | null,
): Promise<Invoice | null> {
  const supabase = getServiceClient("createInvoice");
  if (!supabase) return null;

  const payload: BillingRow = {
    ...pickWritableInvoiceFields(input),
    status: input.status ?? "draft",
    currency: input.currency ?? "usd",
  };

  const { data, error } = await supabase
    .from("invoices")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    warn("createInvoice", error);
    return null;
  }
  if (!data) return null;

  const invoice = invoiceFromRow(data as BillingRow);
  await recordAudit(supabase, {
    ...(actor ?? {}),
    action: "invoice.created",
    resource_type: "invoice",
    resource_id: invoice.id,
    after: invoice,
  });
  return invoice;
}

/** Create one deterministic contract invoice, or reuse it after a failed attach/retry. */
export async function createInvoiceForContract(
  input: InvoiceInput & { contract_id: string; number: string },
  actor?: AuditActor | null,
): Promise<Invoice | null> {
  const supabase = getServiceClient("createInvoiceForContract");
  if (!supabase) return null;

  const findExisting = async () => {
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("contract_id", input.contract_id)
      .eq("number", input.number)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      warn("createInvoiceForContract:existing", error);
      return null;
    }
    return data ? invoiceFromRow(data as BillingRow) : null;
  };

  const existing = await findExisting();
  if (existing) return existing;
  return (await createInvoice(input, actor)) ?? findExisting();
}

/**
 * Insert one quote-backed invoice, or return the concurrent winner.
 * The RPC uses untargeted `ON CONFLICT DO NOTHING` because PostgREST cannot
 * target the partial unique index on non-null inspection_id values.
 */
export async function createInvoiceForInspection(
  input: InvoiceInput & { inspection_id: string },
  actor?: AuditActor | null,
): Promise<Invoice | null> {
  const supabase = getServiceClient("createInvoiceForInspection");
  if (!supabase) return null;

  const { data, error } = await supabase
    .rpc("billing_create_invoice_for_inspection", {
      p_inspection_id: input.inspection_id,
      p_number: input.number ?? "",
      p_amount_due: input.amount_due ?? 0,
      p_currency: input.currency ?? "usd",
      p_status: input.status ?? "draft",
      p_due_date: input.due_date ?? null,
    })
    .maybeSingle();

  if (error) {
    warn("createInvoiceForInspection", error);
    return null;
  }

  if (!data) {
    const { data: existing, error: selectError } = await supabase
      .from("invoices")
      .select("*")
      .eq("inspection_id", input.inspection_id)
      .maybeSingle();
    if (selectError) {
      warn("createInvoiceForInspection:existing", selectError);
      return null;
    }
    return existing ? invoiceFromRow(existing as BillingRow) : null;
  }

  const invoice = invoiceFromRow(data as BillingRow);
  await recordAudit(supabase, {
    ...(actor ?? {}),
    action: "invoice.created",
    resource_type: "invoice",
    resource_id: invoice.id,
    after: invoice,
  });
  return invoice;
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const supabase = getServiceClient("getInvoice");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    warn("getInvoice", error);
    return null;
  }
  return data ? invoiceFromRow(data as BillingRow) : null;
}

export interface ListInvoicesFilter {
  status?: InvoiceStatus;
  inspection_id?: string;
  customer_id?: string;
}

export async function listInvoices(filter?: ListInvoicesFilter): Promise<Invoice[]> {
  const supabase = getServiceClient("listInvoices");
  if (!supabase) return [];

  const { data, error } = await fetchAllRows<BillingRow>((from, to) => {
    let query = supabase.from("invoices").select("*");

    if (filter?.status) query = query.eq("status", filter.status);
    if (filter?.inspection_id) query = query.eq("inspection_id", filter.inspection_id);
    if (filter?.customer_id) query = query.eq("customer_id", filter.customer_id);

    return query.order("created_at", { ascending: false }).range(from, to);
  });

  if (error) {
    warn("listInvoices", error);
    return [];
  }
  return data.map(invoiceFromRow);
}

export async function patchInvoice(
  id: string,
  input: Pick<
    InvoiceInput,
    | "status"
    | "amount_due"
    | "due_date"
    | "stripe_invoice_id"
    | "mercury_invoice_id"
    | "mercury_invoice_slug"
    | "paid_at"
    | "customer_id"
  >,
  actor?: AuditActor | null,
): Promise<Invoice | null> {
  const supabase = getServiceClient("patchInvoice");
  if (!supabase) return null;

  const patch = pickWritableInvoiceFields(input);

  const { data: beforeData, error: beforeError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (beforeError) {
    warn("patchInvoice:before", beforeError);
  }

  const { data, error } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("patchInvoice", error);
    return null;
  }
  if (!data) return null;

  const invoice = invoiceFromRow(data as BillingRow);
  await recordAudit(supabase, {
    ...(actor ?? {}),
    action: "invoice.updated",
    resource_type: "invoice",
    resource_id: invoice.id,
    before: beforeData ? invoiceFromRow(beforeData as BillingRow) : null,
    after: invoice,
  });
  return invoice;
}

/** Attach the worker-created Mercury invoice exactly once. */
export async function attachMercuryInvoice(
  invoiceId: string,
  mercuryInvoiceId: string,
  mercuryInvoiceSlug: string,
): Promise<Invoice | null> {
  const supabase = getServiceClient("attachMercuryInvoice");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("invoices")
    .update({
      mercury_invoice_id: mercuryInvoiceId,
      mercury_invoice_slug: mercuryInvoiceSlug,
    })
    .eq("id", invoiceId)
    .eq("processor", "mercury")
    .eq("status", "open")
    .is("mercury_invoice_id", null)
    .select("*")
    .maybeSingle();
  if (error) {
    warn("attachMercuryInvoice", error);
    return null;
  }
  return data ? invoiceFromRow(data as BillingRow) : null;
}

// --- client projection (LOCKED PATTERN 9) -----------------------------------
// The DB select IS the allow-list — only client-safe columns. Internal fields
// (stripe_invoice_id, inspection_id) never enter this code path.

export async function getClientInvoice(invoiceId: string): Promise<ClientInvoice | null> {
  const supabase = getServiceClient("getClientInvoice");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("invoices")
    .select("id, number, amount_due, currency, status, due_date, card_fee_passthrough")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) {
    warn("getClientInvoice", error);
    return null;
  }
  if (!data) return null;

  const row = data as BillingRow;
  const amountDue = numberOrNull(row.amount_due);
  const cardFeePassthrough = row.card_fee_passthrough === true;
  return {
    id: stringOrNull(row.id) ?? "",
    number: stringOrNull(row.number) ?? "",
    amount_due: amountDue,
    currency: stringOrNull(row.currency) ?? "usd",
    status: statusOrDraft(row.status),
    due_date: stringOrNull(row.due_date),
    card_total: amountDue == null ? null : cardChargeAmount(amountDue, cardFeePassthrough),
    card_fee_passthrough: cardFeePassthrough,
  };
}

// --- payments ---------------------------------------------------------------

export async function recordPayment(
  input: PaymentInput,
  actor?: AuditActor | null,
): Promise<Payment | null> {
  const supabase = getServiceClient("recordPayment");
  if (!supabase) return null;

  const payload: BillingRow = {
    invoice_id: input.invoice_id,
    amount: input.amount,
    status: input.status ?? "pending",
    stripe_payment_intent_id: input.stripe_payment_intent_id ?? null,
    paid_at: input.paid_at ?? null,
  };

  // Idempotency only exists when there is a payment-intent id to conflict on.
  // With one (the webhook path), re-delivery upserts the existing row instead
  // of duplicating. Without one, fall back to a plain insert — upserting
  // onConflict "id" would be a false idempotency claim (id is DB-generated and
  // never in the payload, so it would always insert anyway).
  const query = input.stripe_payment_intent_id
    ? supabase
        .from("payments")
        .upsert(payload, {
          onConflict: "stripe_payment_intent_id",
          ignoreDuplicates: false,
        })
    : supabase.from("payments").insert(payload);

  const { data, error } = await query.select("*").maybeSingle();

  if (error) {
    warn("recordPayment", error);
    return null;
  }
  if (!data) return null;

  const payment = paymentFromRow(data as BillingRow);
  await recordAudit(supabase, {
    ...(actor ?? {}),
    action: "payment.recorded",
    resource_type: "payment",
    resource_id: payment.id,
    after: payment,
  });
  return payment;
}

/** Record Mercury's single successful settlement for an invoice exactly once. */
export async function recordMercuryPayment(input: {
  invoice_id: string;
  amount: number;
  paid_at: string;
}): Promise<Payment | null> {
  const supabase = getServiceClient("recordMercuryPayment");
  if (!supabase) return null;

  const findExisting = async () => {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("invoice_id", input.invoice_id)
      .eq("status", "succeeded")
      .is("stripe_payment_intent_id", null)
      .limit(1)
      .maybeSingle();
    if (error) {
      warn("recordMercuryPayment:existing", error);
      return null;
    }
    return data ? paymentFromRow(data as BillingRow) : null;
  };

  const existing = await findExisting();
  if (existing) return existing;

  const { data, error } = await supabase
    .from("payments")
    .insert({
      invoice_id: input.invoice_id,
      amount: input.amount,
      status: "succeeded",
      stripe_payment_intent_id: null,
      paid_at: input.paid_at,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    // The partial unique index makes concurrent worker posts converge here.
    return findExisting();
  }
  if (!data) return null;

  const payment = paymentFromRow(data as BillingRow);
  await recordAudit(supabase, {
    action: "payment.recorded",
    resource_type: "payment",
    resource_id: payment.id,
    after: payment,
  });
  return payment;
}

/** Mark only an invoice that is still open, so one worker post owns the paid event. */
export async function markMercuryInvoicePaid(
  invoiceId: string,
  paidAt: string,
): Promise<Invoice | null> {
  const supabase = getServiceClient("markMercuryInvoicePaid");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", invoiceId)
    .eq("processor", "mercury")
    .eq("status", "open")
    .select("*")
    .maybeSingle();
  if (error) {
    warn("markMercuryInvoicePaid", error);
    return null;
  }
  return data ? invoiceFromRow(data as BillingRow) : null;
}

/** Void an open Mercury invoice when the remote invoice is cancelled. */
export async function markMercuryInvoiceVoid(invoiceId: string): Promise<Invoice | null> {
  const supabase = getServiceClient("markMercuryInvoiceVoid");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "void" })
    .eq("id", invoiceId)
    .eq("processor", "mercury")
    .eq("status", "open")
    .select("*")
    .maybeSingle();
  if (error) {
    warn("markMercuryInvoiceVoid", error);
    return null;
  }
  return data ? invoiceFromRow(data as BillingRow) : null;
}

/** Insert a refund as its own negative payment row, idempotent by Refund id. */
export async function recordStripeRefund(
  input: StripeRefundInput,
  actor?: AuditActor | null,
): Promise<RecordStripeRefundResult | null> {
  const supabase = getServiceClient("recordStripeRefund");
  if (!supabase) return null;

  const payload: BillingRow = {
    invoice_id: input.invoice_id,
    amount: -Math.abs(input.amount),
    status: "refunded",
    stripe_payment_intent_id: null,
    stripe_refund_id: input.stripe_refund_id,
    paid_at: input.paid_at,
  };

  const { data, error } = await supabase
    .from("payments")
    .upsert(payload, {
      onConflict: "stripe_refund_id",
      ignoreDuplicates: true,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    warn("recordStripeRefund", error);
    return null;
  }

  if (!data) {
    const { data: existing, error: selectError } = await supabase
      .from("payments")
      .select("*")
      .eq("stripe_refund_id", input.stripe_refund_id)
      .maybeSingle();
    if (selectError || !existing) {
      warn("recordStripeRefund:existing", selectError ?? "Refund row not found after conflict.");
      return null;
    }
    return { payment: paymentFromRow(existing as BillingRow), created: false };
  }

  const payment = paymentFromRow(data as BillingRow);
  await recordAudit(supabase, {
    ...(actor ?? {}),
    action: "payment.recorded",
    resource_type: "payment",
    resource_id: payment.id,
    after: payment,
  });
  return { payment, created: true };
}

export async function markInvoicePaid(
  invoiceId: string,
  actor?: AuditActor | null,
): Promise<Invoice | null> {
  return patchInvoice(invoiceId, { status: "paid" }, actor);
}
