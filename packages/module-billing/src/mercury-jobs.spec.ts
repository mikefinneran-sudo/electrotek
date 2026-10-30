import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  attachMercuryInvoice: vi.fn(),
  getInvoice: vi.fn(),
  isBillingConfigured: vi.fn(() => true),
  listInvoices: vi.fn(),
  markMercuryInvoicePaid: vi.fn(),
  markMercuryInvoiceVoid: vi.fn(),
  recordMercuryPayment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./server", () => serverMocks);

import { createMercuryJobHandlers } from "./mercury-jobs";

const INVOICE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const lineItems = [{ name: "Agreement — deposit", quantity: 1, unitPrice: 1250 }];

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    number: "DEP-11111111",
    status: "open",
    processor: "mercury",
    amount_due: 1250,
    line_items: lineItems,
    mercury_invoice_id: null,
    ...overrides,
  };
}

const resolveCreateJob = vi.fn();
const onCreated = vi.fn();
const onPaid = vi.fn();
const handlers = createMercuryJobHandlers({ resolveCreateJob, onCreated, onPaid });

function request(method: "GET" | "POST", body?: unknown, secret = "worker-secret"): Request {
  return new Request("https://app.example/api/billing/mercury-jobs", {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MERCURY_WORKER_SECRET", "worker-secret");
  serverMocks.isBillingConfigured.mockReturnValue(true);
  resolveCreateJob.mockResolvedValue({
    customer: { name: "Ron Rosen", email: "ron@example.com" },
    payerMemo: "Deposit due under Agreement",
    dueInDays: 15,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth", () => {
  it("returns 503 when the worker secret is not configured", async () => {
    vi.stubEnv("MERCURY_WORKER_SECRET", "");
    expect((await handlers.GET(request("GET"))).status).toBe(503);
  });

  it("rejects a wrong or shorter secret without throwing", async () => {
    expect((await handlers.GET(request("GET", undefined, "wrong"))).status).toBe(401);
    expect((await handlers.POST(request("POST", { results: [] }, "")))
      .status).toBe(401);
    expect(serverMocks.listInvoices).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("lists only open Mercury invoices, split into create and check jobs", async () => {
    serverMocks.listInvoices.mockResolvedValue([
      invoice(),
      invoice({ id: OTHER_ID, mercury_invoice_id: "m-2" }),
      invoice({ id: "stripe", processor: "stripe" }),
      invoice({ id: "no-lines", line_items: null }),
    ]);

    const response = await handlers.GET(request("GET"));

    expect(serverMocks.listInvoices).toHaveBeenCalledWith({ status: "open" });
    expect(await response.json()).toEqual({
      create: [
        {
          invoiceId: INVOICE_ID,
          invoiceNumber: "DEP-11111111",
          customer: { name: "Ron Rosen", email: "ron@example.com" },
          lineItems,
          payerMemo: "Deposit due under Agreement",
          dueInDays: 15,
        },
      ],
      check: [{ invoiceId: OTHER_ID, mercuryInvoiceId: "m-2" }],
    });
  });
});

describe("POST", () => {
  it("attaches a created invoice once and runs onCreated", async () => {
    serverMocks.attachMercuryInvoice.mockResolvedValueOnce(invoice({ mercury_invoice_id: "m-1" }));
    serverMocks.attachMercuryInvoice.mockResolvedValueOnce(null);
    const body = {
      results: [{ type: "created", invoiceId: INVOICE_ID, mercuryInvoiceId: "m-1", slug: "s-1" }],
    };

    const first = await handlers.POST(request("POST", body));
    const second = await handlers.POST(request("POST", body));

    expect(await first.json()).toEqual({ ok: true, processed: { created: 1, paid: 0, voided: 0 } });
    expect(await second.json()).toEqual({ ok: true, processed: { created: 0, paid: 0, voided: 0 } });
    expect(serverMocks.attachMercuryInvoice).toHaveBeenCalledWith(INVOICE_ID, "m-1", "s-1");
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("records a Paid result as one payment and fires onPaid", async () => {
    serverMocks.getInvoice.mockResolvedValue(invoice({ mercury_invoice_id: "m-1", amount_due: 1286.55 }));
    serverMocks.recordMercuryPayment.mockResolvedValue({ id: "payment" });
    serverMocks.markMercuryInvoicePaid.mockResolvedValue(invoice({ status: "paid" }));

    const response = await handlers.POST(
      request("POST", { results: [{ type: "status", invoiceId: INVOICE_ID, status: "Paid" }] }),
    );

    expect(await response.json()).toEqual({ ok: true, processed: { created: 0, paid: 1, voided: 0 } });
    expect(serverMocks.recordMercuryPayment).toHaveBeenCalledWith(
      expect.objectContaining({ invoice_id: INVOICE_ID, amount: 1286.55 }),
    );
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it("does not mark paid an invoice that is not an open Mercury invoice", async () => {
    serverMocks.getInvoice.mockResolvedValue(invoice({ processor: "stripe", mercury_invoice_id: "m-1" }));

    await handlers.POST(
      request("POST", { results: [{ type: "status", invoiceId: INVOICE_ID, status: "Paid" }] }),
    );

    expect(serverMocks.recordMercuryPayment).not.toHaveBeenCalled();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("voids on Cancelled and ignores Unpaid", async () => {
    serverMocks.markMercuryInvoiceVoid.mockResolvedValue(invoice({ status: "void" }));

    const response = await handlers.POST(
      request("POST", {
        results: [
          { type: "status", invoiceId: INVOICE_ID, status: "Cancelled" },
          { type: "status", invoiceId: OTHER_ID, status: "Unpaid" },
        ],
      }),
    );

    expect(await response.json()).toEqual({ ok: true, processed: { created: 0, paid: 0, voided: 1 } });
    expect(serverMocks.markMercuryInvoiceVoid).toHaveBeenCalledTimes(1);
    expect(serverMocks.getInvoice).not.toHaveBeenCalled();
  });

  it("keeps processing the batch when a hook throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    serverMocks.attachMercuryInvoice.mockImplementation(async (id: string) =>
      invoice({ id, mercury_invoice_id: "m" }),
    );
    onCreated.mockRejectedValueOnce(new Error("CRM down"));

    const response = await handlers.POST(
      request("POST", {
        results: [
          { type: "created", invoiceId: INVOICE_ID, mercuryInvoiceId: "m-1", slug: "s-1" },
          { type: "created", invoiceId: OTHER_ID, mercuryInvoiceId: "m-2", slug: "s-2" },
        ],
      }),
    );

    expect(await response.json()).toEqual({ ok: true, processed: { created: 2, paid: 0, voided: 0 } });
    expect(onCreated).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed results and unknown fields", async () => {
    for (const results of [
      [],
      [{ type: "created", invoiceId: "not-a-uuid", mercuryInvoiceId: "m", slug: "s" }],
      [{ type: "status", invoiceId: INVOICE_ID, status: "Refunded" }],
      [{ type: "status", invoiceId: INVOICE_ID, status: "Paid", amount: 1 }],
    ]) {
      expect((await handlers.POST(request("POST", { results }))).status).toBe(400);
    }
    expect(serverMocks.attachMercuryInvoice).not.toHaveBeenCalled();
  });
});
