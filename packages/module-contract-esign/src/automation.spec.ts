import { beforeEach, describe, expect, it, vi } from "vitest";

const billingMocks = vi.hoisted(() => ({ issueContractDepositInvoice: vi.fn() }));
const emailMocks = vi.hoisted(() => ({
  sendDepositDueEmail: vi.fn(),
  sendPaymentReceiptEmail: vi.fn(),
  sendSignInviteEmail: vi.fn(),
}));
const serverMocks = vi.hoisted(() => ({
  attachDepositInvoice: vi.fn(),
  getContract: vi.fn(),
  markDepositInvoiceSent: vi.fn(),
  markSignInviteSent: vi.fn(),
}));
const followupMocks = vi.hoisted(() => ({
  cancelFollowups: vi.fn(),
  scheduleSignatureFollowups: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@waltersignal/bananaforce-module-billing/contract-deposit", () => billingMocks);
vi.mock("./email", () => emailMocks);
vi.mock("./followups", () => followupMocks);
vi.mock("./server", () => serverMocks);

import { afterDepositPaid, afterDocumentSent, afterDocumentSigned } from "./automation";

const CONTRACT_ID = "fd65d150-23ea-4c10-a408-598834517794";
const settings = { brandName: "WalterSignal", senderName: "Mike Finneran" };
const crmEvent = vi.fn();
const settingsWithCrm = { ...settings, crm: { onEvent: crmEvent } };

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_ID,
    title: "DoinZip Client Services Agreement",
    signer_name: "Ron Rosen",
    signer_email: "ron@example.com",
    deposit_amount_due: 1250,
    card_fee_passthrough: true,
    deposit_invoice_id: null,
    sign_invite_sent_at: null,
    status: "signed",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  crmEvent.mockReset();
  followupMocks.cancelFollowups.mockResolvedValue([]);
  followupMocks.scheduleSignatureFollowups.mockResolvedValue(true);
  serverMocks.markSignInviteSent.mockResolvedValue(null);
  serverMocks.attachDepositInvoice.mockResolvedValue(true);
  billingMocks.issueContractDepositInvoice.mockResolvedValue({
    invoiceId: "11111111-1111-4111-8111-111111111111",
    invoiceNumber: "DEP-FD65D150",
    processor: "stripe",
    payUrl: "https://app.example/pay?token=t&id=1",
    amountDue: 1250,
    cardTotal: 1286.55,
  });
});

describe("afterDocumentSigned", () => {
  it("issues the deposit with the contract's card-fee setting and marks it sent", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    emailMocks.sendDepositDueEmail.mockResolvedValue({ ok: true });

    const result = await afterDocumentSigned({
      contractId: CONTRACT_ID,
      signerName: "Ron Rosen",
      origin: "https://app.example",
      settings,
    });

    expect(result).toEqual({ depositEmailed: true });
    expect(billingMocks.issueContractDepositInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountDue: 1250, cardFeePassthrough: true }),
    );
    expect(emailMocks.sendDepositDueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ amountDue: 1250, cardTotal: 1286.55, invoiceNumber: "DEP-FD65D150" }),
    );
    expect(serverMocks.markDepositInvoiceSent).toHaveBeenCalledWith(CONTRACT_ID);
  });

  it("does not mark the deposit sent when the email fails", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    emailMocks.sendDepositDueEmail.mockResolvedValue({ ok: false, error: "boom" });

    const result = await afterDocumentSigned({
      contractId: CONTRACT_ID,
      signerName: "Ron Rosen",
      origin: "https://app.example",
      settings,
    });

    expect(result).toEqual({ depositEmailed: false });
    expect(serverMocks.markDepositInvoiceSent).not.toHaveBeenCalled();
  });

  it("issues nothing when a deposit invoice is already attached", async () => {
    serverMocks.getContract.mockResolvedValue(
      contract({ deposit_invoice_id: "22222222-2222-4222-8222-222222222222" }),
    );

    await afterDocumentSigned({
      contractId: CONTRACT_ID,
      signerName: "Ron Rosen",
      origin: "https://app.example",
      settings,
    });

    expect(billingMocks.issueContractDepositInvoice).not.toHaveBeenCalled();
  });

  it("sends no deposit email when the invoice could not be attached", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    serverMocks.attachDepositInvoice.mockResolvedValue(false);

    await afterDocumentSigned({
      contractId: CONTRACT_ID,
      signerName: "Ron Rosen",
      origin: "https://app.example",
      settings,
    });

    expect(emailMocks.sendDepositDueEmail).not.toHaveBeenCalled();
  });

  it("queues the Mercury invoice for the worker and emits agreement_signed only", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    billingMocks.issueContractDepositInvoice.mockResolvedValue({
      invoiceId: "11111111-1111-4111-8111-111111111111",
      invoiceNumber: "DEP-FD65D150",
      processor: "mercury",
      payUrl: null,
      amountDue: 1286.55,
      cardTotal: 1286.55,
    });

    const result = await afterDocumentSigned({
      contractId: CONTRACT_ID,
      signerName: "Ron Rosen",
      origin: "https://app.example",
      settings: settingsWithCrm,
    });

    expect(result).toEqual({ depositEmailed: false });
    expect(serverMocks.attachDepositInvoice).toHaveBeenCalledWith(
      CONTRACT_ID,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(emailMocks.sendDepositDueEmail).not.toHaveBeenCalled();
    // The worker marks it sent and logs deposit_invoiced once Mercury has the invoice.
    expect(serverMocks.markDepositInvoiceSent).not.toHaveBeenCalled();
    expect(crmEvent).toHaveBeenCalledTimes(1);
    expect(crmEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agreement_signed" }),
    );
  });

  it("does not let a CRM failure break signing automation", async () => {
    serverMocks.getContract.mockResolvedValue(contract({ deposit_amount_due: null }));
    crmEvent.mockRejectedValue(new Error("CRM unavailable"));

    await expect(
      afterDocumentSigned({
        contractId: CONTRACT_ID,
        signerName: "Ron Rosen",
        origin: "https://app.example",
        settings: settingsWithCrm,
      }),
    ).resolves.toEqual({ depositEmailed: false });
  });

  it("cancels and logs every remaining touch when the contract is signed", async () => {
    serverMocks.getContract.mockResolvedValue(contract({ deposit_amount_due: null }));
    followupMocks.cancelFollowups.mockResolvedValue([
      { id: "followup-1", touch: 2, channel: "email" },
      { id: "followup-2", touch: 2, channel: "text" },
    ]);

    await afterDocumentSigned({
      contractId: CONTRACT_ID,
      signerName: "Ron Rosen",
      origin: "https://app.example",
      settings: settingsWithCrm,
    });

    expect(followupMocks.cancelFollowups).toHaveBeenCalledWith(
      CONTRACT_ID,
      "Contract signed.",
    );
    expect(crmEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "followup_canceled",
        detail: expect.objectContaining({ touch: 2, channel: "email" }),
      }),
    );
    expect(crmEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "followup_canceled",
        detail: expect.objectContaining({ touch: 2, channel: "text" }),
      }),
    );
  });
});

describe("afterDocumentSent", () => {
  it("emails the sign link and records the invite", async () => {
    emailMocks.sendSignInviteEmail.mockResolvedValue({ ok: true });

    const result = await afterDocumentSent({
      contract: contract({ status: "sent" }) as never,
      signUrl: "https://app.example/sign?token=t",
      settings,
    });

    expect(result).toEqual({ signInviteSent: true });
    expect(serverMocks.markSignInviteSent).toHaveBeenCalledWith(CONTRACT_ID);
  });

  it("schedules the configured cadence after the invite is recorded", async () => {
    emailMocks.sendSignInviteEmail.mockResolvedValue({ ok: true });
    serverMocks.markSignInviteSent.mockResolvedValue(
      contract({ status: "sent", sign_invite_sent_at: "2026-10-24T20:00:00Z" }),
    );

    await afterDocumentSent({
      contract: contract({ status: "sent" }) as never,
      signUrl: "https://app.example/sign?token=t",
      settings: { ...settings, followups: { enabled: true } },
    });

    expect(followupMocks.scheduleSignatureFollowups).toHaveBeenCalledWith(
      CONTRACT_ID,
      { texts: false },
    );
  });

  it("records the agreement-sent CRM event after the invite succeeds", async () => {
    emailMocks.sendSignInviteEmail.mockResolvedValue({ ok: true });

    await afterDocumentSent({
      contract: contract({ status: "sent" }) as never,
      signUrl: "https://app.example/sign?token=t",
      settings: settingsWithCrm,
    });

    expect(crmEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agreement_sent" }),
    );
  });

  it("reports the error and records nothing when the invite fails", async () => {
    emailMocks.sendSignInviteEmail.mockResolvedValue({ ok: false, error: "Email is not configured." });

    const result = await afterDocumentSent({
      contract: contract({ status: "sent" }) as never,
      signUrl: "https://app.example/sign?token=t",
      settings,
    });

    expect(result).toEqual({ signInviteSent: false, error: "Email is not configured." });
    expect(serverMocks.markSignInviteSent).not.toHaveBeenCalled();
  });
});

describe("afterDepositPaid", () => {
  const paid = {
    invoiceNumber: "DEP-FD65D150",
    amount: 1286.55,
    paidAt: new Date("2026-10-24T15:00:00Z"),
    processor: "mercury" as const,
  };

  it("emails the client a receipt and logs deposit_paid", async () => {
    emailMocks.sendPaymentReceiptEmail.mockResolvedValue({ ok: true });

    const result = await afterDepositPaid({
      contract: contract() as never,
      ...paid,
      settings: settingsWithCrm,
    });

    expect(result).toEqual({ receiptSent: true });
    expect(emailMocks.sendPaymentReceiptEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ron@example.com",
        signerName: "Ron Rosen",
        invoiceNumber: "DEP-FD65D150",
        amount: 1286.55,
        title: "DoinZip Client Services Agreement",
      }),
    );
    expect(crmEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "deposit_paid" }),
    );
  });

  it("still sends the receipt when the CRM event fails", async () => {
    emailMocks.sendPaymentReceiptEmail.mockResolvedValue({ ok: true });
    crmEvent.mockRejectedValue(new Error("CRM unavailable"));

    await expect(
      afterDepositPaid({ contract: contract() as never, ...paid, settings: settingsWithCrm }),
    ).resolves.toEqual({ receiptSent: true });
  });

  it("sends nothing without a signer email", async () => {
    const result = await afterDepositPaid({
      contract: contract({ signer_email: null }) as never,
      ...paid,
      settings,
    });

    expect(result).toEqual({ receiptSent: false });
    expect(emailMocks.sendPaymentReceiptEmail).not.toHaveBeenCalled();
  });
});
