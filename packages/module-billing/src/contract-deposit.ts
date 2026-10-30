import "server-only";

import { createInvoiceForContract, isBillingConfigured } from "./server";
import { createPayLinkToken, isBillingTokenConfigured } from "./tokens";
import { isStripeConfigured } from "./stripe";
import { CARD_FEE_FIXED, CARD_FEE_PERCENT, cardChargeAmount } from "./invoices";
import { payPageUrl } from "./pay-page-url";
import type { InvoiceLineItem, InvoiceProcessor } from "./types";

export interface IssueContractDepositInput {
  contractId: string;
  contractTitle: string | null;
  amountDue: number;
  /** Add the processing fee as an invoice line when the agreement passes it through. */
  cardFeePassthrough?: boolean;
  currency?: string;
  origin: string;
}

export interface IssueContractDepositResult {
  invoiceId: string;
  invoiceNumber: string;
  processor: InvoiceProcessor;
  payUrl: string | null;
  /** Invoice total; for Mercury it includes the processing-fee line when passed through. */
  amountDue: number;
  /** What paying by card charges, fee included when passed through. */
  cardTotal: number;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function depositLineItems(
  title: string,
  deposit: number,
  feePassthrough: boolean,
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [
    { name: `${title} — deposit`, quantity: 1, unitPrice: deposit },
  ];
  if (feePassthrough) {
    items.push({
      name: "Payment processing fee",
      quantity: 1,
      unitPrice: roundMoney(deposit * CARD_FEE_PERCENT + CARD_FEE_FIXED),
    });
  }
  return items;
}

/**
 * Create an open invoice for a contract deposit. Mercury jobs are selected
 * explicitly; otherwise the existing Stripe pay-page path remains unchanged.
 */
export async function issueContractDepositInvoice(
  input: IssueContractDepositInput,
): Promise<IssueContractDepositResult | null> {
  if (!isBillingConfigured()) return null;
  if (!Number.isFinite(input.amountDue) || input.amountDue <= 0) return null;

  const requestedProcessor: InvoiceProcessor =
    process.env.CONTRACT_DEPOSIT_PROCESSOR?.trim().toLowerCase() === "mercury"
      ? "mercury"
      : "stripe";
  if (
    requestedProcessor === "stripe" &&
    (!isBillingTokenConfigured() || !isStripeConfigured())
  ) {
    return null;
  }

  const slug = input.contractId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const deposit = roundMoney(input.amountDue);
  const passthrough = input.cardFeePassthrough === true;
  // Mercury charges every line regardless of payment method, so the fee is its own line.
  // The Stripe pay page adds the fee at card checkout instead, as before.
  const lineItems =
    requestedProcessor === "mercury"
      ? depositLineItems(input.contractTitle?.trim() || "Agreement", deposit, passthrough)
      : null;
  const amountDue = lineItems
    ? roundMoney(lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0))
    : deposit;
  const invoice = await createInvoiceForContract({
    contract_id: input.contractId,
    number: `DEP-${slug}`,
    amount_due: amountDue,
    card_fee_passthrough: lineItems ? false : passthrough,
    currency: input.currency ?? "usd",
    status: "open",
    // The Stripe path keeps its original column set.
    ...(lineItems ? { processor: requestedProcessor, line_items: lineItems } : {}),
  });
  if (!invoice) return null;

  if (invoice.processor === "mercury") {
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      processor: "mercury",
      payUrl: null,
      amountDue: invoice.amount_due ?? amountDue,
      cardTotal: invoice.amount_due ?? amountDue,
    };
  }

  try {
    const token = await createPayLinkToken(invoice.id);
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      processor: "stripe",
      payUrl: payPageUrl(input.origin, token, invoice.id),
      amountDue: invoice.amount_due ?? amountDue,
      cardTotal: cardChargeAmount(invoice.amount_due ?? amountDue, invoice.card_fee_passthrough === true),
    };
  } catch {
    return null;
  }
}
