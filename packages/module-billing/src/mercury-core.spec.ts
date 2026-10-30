import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createMercuryInvoice,
  findOrCreateMercuryCustomer,
  getMercuryInvoice,
} from "./mercury-core";

const fetchMock = vi.fn<typeof fetch>();
const config = {
  apiToken: "test-token",
  ccEmails: [] as string[],
  cardEnabled: true,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice-1",
    invoiceNumber: "DEP-12345678",
    slug: "public-slug",
    status: "Unpaid",
    amount: 1250,
    updatedAt: "2026-10-23T12:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T02:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Mercury customers", () => {
  it("paginates and matches email case-insensitively", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          customers: [{ id: "other", name: "Other", email: "other@example.com" }],
          page: { nextPage: "cursor-1" },
        }),
      )
      .mockResolvedValueOnce(
        response({
          customers: [{ id: "customer-1", name: "Client", email: "CLIENT@EXAMPLE.COM" }],
          page: {},
        }),
      );

    const result = await findOrCreateMercuryCustomer(config, {
      name: "Client",
      email: "client@example.com",
    });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "customer-1" }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("start_after=cursor-1");
  });

  it("creates a customer with a structured address when no match exists", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ customers: [], page: {} }))
      .mockResolvedValueOnce(
        response({ id: "customer-2", name: "Client", email: "client@example.com" }),
      );

    const result = await findOrCreateMercuryCustomer(config, {
      name: "Client",
      email: "client@example.com",
      address: {
        name: "Client",
        address1: "123 Main Street",
        city: "Indianapolis",
        region: "IN",
        postalCode: "46204",
        country: "US",
      },
    });

    expect(result.ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body.address).toMatchObject({ address1: "123 Main Street", region: "IN" });
  });
});

describe("Mercury invoices", () => {
  it("selects an active checking account and sends the required invoice fields", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ invoices: [], page: {} }))
      .mockResolvedValueOnce(
        response({
          accounts: [
            { id: "savings", kind: "savings", status: "active" },
            { id: "checking", type: "checking", status: "active" },
          ],
        }),
      )
      .mockResolvedValueOnce(response(invoice()));

    const result = await createMercuryInvoice({
      ...config,
      ccEmails: ["billing@example.com", "owner@example.com"],
    }, {
      customerId: "customer-1",
      invoiceNumber: "DEP-12345678",
      lineItems: [
        { name: "Client Agreement — deposit", quantity: 1, unitPrice: 1250 },
        { name: "Payment processing fee", quantity: 1, unitPrice: 36.55 },
      ],
      payerMemo: "Deposit due under Client Agreement",
    });

    expect(result).toEqual({ ok: true, data: expect.objectContaining({ id: "invoice-1" }) });
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(body).toMatchObject({
      invoiceDate: "2026-10-22",
      dueDate: "2026-11-06",
      destinationAccountId: "checking",
      creditCardEnabled: true,
      achDebitEnabled: true,
      useRealAccountNumber: false,
      sendEmailOption: "SendNow",
      ccEmails: ["billing@example.com", "owner@example.com"],
      lineItems: [
        { name: "Client Agreement — deposit", quantity: 1, unitPrice: 1250 },
        { name: "Payment processing fee", quantity: 1, unitPrice: 36.55 },
      ],
    });
  });

  it("uses the configured account, disables cards with 0, and recovers a duplicate", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ invoices: [], page: {} }))
      .mockResolvedValueOnce(response({ error: "duplicate invoice number" }, 400))
      .mockResolvedValueOnce(
        response({ invoices: [invoice({ id: "existing-invoice" })], page: {} }),
      );

    const result = await createMercuryInvoice({
      ...config,
      accountId: "configured-account",
      cardEnabled: false,
    }, {
      customerId: "customer-1",
      invoiceNumber: "DEP-12345678",
      lineItems: [{ name: "Agreement — deposit", quantity: 1, unitPrice: 1250 }],
    });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "existing-invoice" }),
    });
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({
      destinationAccountId: "configured-account",
      creditCardEnabled: false,
    });
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/ar/invoices?");
  });

  it("returns an invoice already created under the number without posting again", async () => {
    fetchMock.mockResolvedValueOnce(
      response({ invoices: [invoice({ id: "existing-invoice" })], page: {} }),
    );

    const result = await createMercuryInvoice({ ...config, accountId: "configured-account" }, {
      customerId: "customer-1",
      invoiceNumber: "DEP-12345678",
      lineItems: [{ name: "Agreement — deposit", quantity: 1, unitPrice: 1250 }],
    });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "existing-invoice" }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it("does not create when the number lookup fails", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "unavailable" }, 503));

    const result = await createMercuryInvoice({ ...config, accountId: "configured-account" }, {
      customerId: "customer-1",
      invoiceNumber: "DEP-12345678",
      lineItems: [{ name: "Agreement — deposit", quantity: 1, unitPrice: 1250 }],
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads one invoice with global fetch only", async () => {
    fetchMock.mockResolvedValueOnce(response(invoice({ status: "Paid" })));

    const result = await getMercuryInvoice(config, "invoice-1");

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "invoice-1", status: "Paid" }),
    });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("dispatcher");
  });

  it("returns a typed error instead of throwing when unconfigured", async () => {
    await expect(getMercuryInvoice({ ...config, apiToken: "" }, "invoice-1")).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: "not_configured" }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
