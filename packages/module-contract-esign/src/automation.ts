import "server-only";

import { issueContractDepositInvoice } from "@waltersignal/bananaforce-module-billing/contract-deposit";
import type { Contract } from "./types";
import {
  sendDepositDueEmail,
  sendPaymentReceiptEmail,
  sendSignInviteEmail,
} from "./email";
import {
  attachDepositInvoice,
  getContract,
  markDepositInvoiceSent,
  markSignInviteSent,
} from "./server";
import {
  cancelFollowups,
  scheduleSignatureFollowups,
  type FollowupChannel,
} from "./followups";

export interface ContractAutomationSettings {
  brandName: string;
  /** Person who signs off the client emails, e.g. "Mike Finneran". */
  senderName?: string;
  /** When true, skip sign invite and deposit emails (tests). */
  disabled?: boolean;
  /** App-level opt-in to the fixed Day 0/3/7/11 signature-reminder cadence. */
  followups?: { enabled: boolean };
  /** Optional app-owned CRM integration; contract-esign never imports CRM. */
  crm?: {
    resolve?: (
      signerEmail: string,
    ) =>
      | Promise<ContractCrmLinks | null>
      | ContractCrmLinks
      | null;
    resolvePhone?: (contract: Contract) => Promise<string | null> | string | null;
    onEvent?: (input: ContractCrmEventInput) => Promise<void> | void;
  };
}

export interface ContractCrmLinks {
  accountId: string | null;
  contactId: string | null;
  opportunityId: string | null;
}

export type ContractCrmEvent =
  | "agreement_sent"
  | "agreement_signed"
  | "deposit_invoiced"
  | "deposit_paid"
  | "followup_sent"
  | "followup_failed"
  | "followup_canceled";

export interface ContractCrmEventInput {
  contract: Contract;
  event: ContractCrmEvent;
  detail?: {
    signerName?: string;
    invoiceNumber?: string;
    amount?: number;
    processor?: "mercury" | "stripe";
    touch?: number;
    total?: number;
    channel?: FollowupChannel;
    error?: string;
  };
}

function automationEnabled(settings: ContractAutomationSettings): boolean {
  if (settings.disabled) return false;
  if (process.env.CONTRACT_AUTOMATION === "0") return false;
  return true;
}

async function emitCrmEvent(
  settings: ContractAutomationSettings,
  event: ContractCrmEventInput,
): Promise<void> {
  try {
    await settings.crm?.onEvent?.(event);
  } catch {
    console.warn("[contract-esign] CRM event failed:", event.contract.id, event.event);
  }
}

/** After staff uploads a document and a sign link is minted. */
export async function afterDocumentSent(input: {
  contract: Contract;
  signUrl: string;
  settings: ContractAutomationSettings;
}): Promise<{ signInviteSent: boolean; error?: string }> {
  if (!automationEnabled(input.settings)) return { signInviteSent: false };
  if (input.contract.sign_invite_sent_at) return { signInviteSent: false };
  const email = input.contract.signer_email?.trim();
  if (!email) return { signInviteSent: false, error: "No signer email." };

  const result = await sendSignInviteEmail({
    to: email,
    signerName: input.contract.signer_name ?? "Client",
    signUrl: input.signUrl,
    brandName: input.settings.brandName,
    senderName: input.settings.senderName,
    title: input.contract.title ?? "Agreement",
  });
  if (result.ok) {
    const marked = await markSignInviteSent(input.contract.id);
    await emitCrmEvent(input.settings, {
      contract: marked ?? input.contract,
      event: "agreement_sent",
    });
    if (marked && input.settings.followups?.enabled) {
      await scheduleSignatureFollowups(marked.id, {
        texts: marked.followup_texts === true,
      });
    }
    return { signInviteSent: true };
  }
  console.warn("[contract-esign] sign invite not sent:", input.contract.id, result.error);
  return { signInviteSent: false, error: result.error };
}

/** After a document contract is signed and the executed PDF is stored. */
export async function afterDocumentSigned(input: {
  contractId: string;
  signerName: string;
  origin: string;
  settings: ContractAutomationSettings;
}): Promise<{ depositEmailed: boolean }> {
  const contract = await getContract(input.contractId);
  if (!contract) return { depositEmailed: false };
  const canceled = await cancelFollowups(contract.id, "Contract signed.");
  for (const followup of canceled) {
    await emitCrmEvent(input.settings, {
      contract,
      event: "followup_canceled",
      detail: {
        touch: followup.touch,
        total: 4,
        channel: followup.channel,
        error: "Contract signed.",
      },
    });
  }
  if (!automationEnabled(input.settings)) return { depositEmailed: false };
  if (contract.deposit_invoice_id) return { depositEmailed: false };

  await emitCrmEvent(input.settings, {
    contract,
    event: "agreement_signed",
    detail: { signerName: input.signerName },
  });

  if (!contract.deposit_amount_due || contract.deposit_amount_due <= 0) {
    return { depositEmailed: false };
  }

  const email = contract.signer_email?.trim();
  if (!email) return { depositEmailed: false };

  const issued = await issueContractDepositInvoice({
    contractId: contract.id,
    contractTitle: contract.title ?? null,
    amountDue: contract.deposit_amount_due,
    cardFeePassthrough: contract.card_fee_passthrough === true,
    origin: input.origin,
  });
  if (!issued) {
    console.warn(
      "[contract-esign] deposit invoice not issued:",
      contract.id,
    );
    return { depositEmailed: false };
  }
  if (!(await attachDepositInvoice(contract.id, issued.invoiceId))) {
    return { depositEmailed: false };
  }

  // The Hetzner worker sends Mercury's invoice and reports creation later.
  if (issued.processor === "mercury") return { depositEmailed: false };
  if (!issued.payUrl) return { depositEmailed: false };

  const result = await sendDepositDueEmail({
    to: email,
    signerName: input.signerName,
    payUrl: issued.payUrl,
    invoiceNumber: issued.invoiceNumber,
    amountDue: issued.amountDue,
    cardTotal: issued.cardTotal,
    brandName: input.settings.brandName,
    senderName: input.settings.senderName,
    title: contract.title ?? "Agreement",
  });
  if (!result.ok) {
    console.warn("[contract-esign] deposit email not sent:", contract.id, result.error);
    return { depositEmailed: false };
  }
  await markDepositInvoiceSent(contract.id);
  await emitCrmEvent(input.settings, {
    contract: { ...contract, deposit_invoice_id: issued.invoiceId },
    event: "deposit_invoiced",
    detail: {
      invoiceNumber: issued.invoiceNumber,
      amount: issued.amountDue,
      processor: "stripe",
    },
  });
  return { depositEmailed: true };
}

/** After a deposit invoice is paid: email the client a receipt and log the payment in the CRM. */
export async function afterDepositPaid(input: {
  contract: Contract;
  invoiceNumber: string;
  amount: number;
  paidAt: Date;
  processor: "mercury" | "stripe";
  settings: ContractAutomationSettings;
}): Promise<{ receiptSent: boolean }> {
  if (!automationEnabled(input.settings)) return { receiptSent: false };
  await emitCrmEvent(input.settings, {
    contract: input.contract,
    event: "deposit_paid",
    detail: {
      invoiceNumber: input.invoiceNumber,
      amount: input.amount,
      processor: input.processor,
    },
  });

  const email = input.contract.signer_email?.trim();
  if (!email) return { receiptSent: false };
  const result = await sendPaymentReceiptEmail({
    to: email,
    signerName: input.contract.signer_name ?? "Client",
    invoiceNumber: input.invoiceNumber,
    amount: input.amount,
    paidAt: input.paidAt,
    brandName: input.settings.brandName,
    senderName: input.settings.senderName,
    title: input.contract.title ?? "Agreement",
  });
  if (!result.ok) {
    console.warn("[contract-esign] payment receipt not sent:", input.contract.id, result.error);
  }
  return { receiptSent: result.ok };
}
