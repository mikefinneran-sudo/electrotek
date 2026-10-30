import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  createInvoiceForContract: vi.fn(),
  isBillingConfigured: vi.fn(() => true),
}));
const tokenMocks = vi.hoisted(() => ({
  createPayLinkToken: vi.fn(),
  isBillingTokenConfigured: vi.fn(() => true),
}));
const stripeMocks = vi.hoisted(() => ({ isStripeConfigured: vi.fn(() => true) }));

vi.mock("server-only", () => ({}));
vi.mock("./server", () => serverMocks);
vi.mock("./tokens", () => tokenMocks);
vi.mock("./stripe", () => stripeMocks);

import { issueContractDepositInvoice } from "./contract-deposit";

const input = {
  contractId: "fd65d150-23ea-4c10-a408-598834517794",
  contractTitle: "Client Services Agreement",
  amountDue: 1250,
  cardFeePassthrough: true,
  origin: "https://app.example",
};

beforeEach(() => {
  vi.clearAllMocks();
  serverMocks.isBillingConfigured.mockReturnValue(true);
  tokenMocks.isBillingTokenConfigured.mockReturnValue(true);
  stripeMocks.isStripeConfigured.mockReturnValue(true);
  // Echo the insert back as the stored row.
  serverMocks.createInvoiceForContract.mockImplementation(async (row) => ({
    id: "local-invoice",
    ...row,
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("issueContractDepositInvoice", () => {
  it("queues a Mercury invoice with a separate processing-fee line and no Stripe dependency", async () => {
    vi.stubEnv("CONTRACT_DEPOSIT_PROCESSOR", "mercury");
    tokenMocks.isBillingTokenConfigured.mockReturnValue(false);
    stripeMocks.isStripeConfigured.mockReturnValue(false);

    const result = await issueContractDepositInvoice(input);

    expect(result).toEqual({
      invoiceId: "local-invoice",
      invoiceNumber: "DEP-FD65D150",
      processor: "mercury",
      payUrl: null,
      amountDue: 1286.55,
      cardTotal: 1286.55,
    });
    expect(serverMocks.createInvoiceForContract).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_due: 1286.55,
        card_fee_passthrough: false,
        processor: "mercury",
        line_items: [
          { name: "Client Services Agreement — deposit", quantity: 1, unitPrice: 1250 },
          { name: "Payment processing fee", quantity: 1, unitPrice: 36.55 },
        ],
      }),
    );
    expect(tokenMocks.createPayLinkToken).not.toHaveBeenCalled();
  });

  it("adds no fee line when the agreement does not pass the fee through", async () => {
    vi.stubEnv("CONTRACT_DEPOSIT_PROCESSOR", "mercury");

    const result = await issueContractDepositInvoice({ ...input, amountDue: 750, cardFeePassthrough: false });

    expect(result).toMatchObject({ processor: "mercury", amountDue: 750 });
    expect(serverMocks.createInvoiceForContract).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_due: 750,
        line_items: [{ name: "Client Services Agreement — deposit", quantity: 1, unitPrice: 750 }],
      }),
    );
  });

  it("returns the stored invoice when it already exists", async () => {
    vi.stubEnv("CONTRACT_DEPOSIT_PROCESSOR", "mercury");
    serverMocks.createInvoiceForContract.mockResolvedValue({
      id: "existing-invoice",
      number: "DEP-FD65D150",
      amount_due: 1286.55,
      processor: "mercury",
    });

    const result = await issueContractDepositInvoice(input);

    expect(result).toMatchObject({ invoiceId: "existing-invoice", amountDue: 1286.55 });
  });

  it("keeps the Stripe pay-page path unchanged when Mercury is not selected", async () => {
    tokenMocks.createPayLinkToken.mockResolvedValue("pay-token");

    const result = await issueContractDepositInvoice(input);

    expect(result).toMatchObject({
      processor: "stripe",
      payUrl: expect.stringContaining("/pay?token=pay-token"),
      amountDue: 1250,
      cardTotal: 1286.55,
    });
    expect(serverMocks.createInvoiceForContract).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_due: 1250,
        card_fee_passthrough: true,
      }),
    );
    const written = serverMocks.createInvoiceForContract.mock.calls[0]?.[0];
    expect(written).not.toHaveProperty("processor");
    expect(written).not.toHaveProperty("line_items");
  });

  it("issues nothing on the Stripe path when Stripe is not configured", async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(false);

    expect(await issueContractDepositInvoice(input)).toBeNull();
    expect(serverMocks.createInvoiceForContract).not.toHaveBeenCalled();
  });
});
