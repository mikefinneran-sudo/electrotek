export const INVOICE_STATUSES = [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type InvoiceProcessor = "stripe" | "mercury";

export interface InvoiceLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export const PAYMENT_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "refunded",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Full invoice row (staff view — includes internal fields). */
export interface Invoice {
  id: string;
  inspection_id: string | null;
  customer_id: string | null;
  contract_id: string | null;
  /** Card payments add the processing fee (2.9% + $0.30) on top of amount_due. */
  card_fee_passthrough: boolean;
  number: string;
  amount_due: number | null;
  currency: string;
  status: InvoiceStatus;
  processor: InvoiceProcessor | null;
  line_items: InvoiceLineItem[] | null;
  stripe_invoice_id: string | null;
  mercury_invoice_id: string | null;
  mercury_invoice_slug: string | null;
  due_date: string | null;
  paid_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Payment row. */
export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  created_at?: string;
}

/**
 * Client-safe invoice projection. Only columns the client token holder may see:
 * no stripe_invoice_id, no inspection_id. The DB select IS the allow-list.
 */
export interface ClientInvoice {
  id: string;
  number: string;
  amount_due: number | null;
  currency: string;
  status: InvoiceStatus;
  due_date: string | null;
  /** What a card payment charges: amount_due plus the fee when it is passed through. */
  card_total: number | null;
  card_fee_passthrough: boolean;
}
