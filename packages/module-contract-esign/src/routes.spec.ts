import { PDFDocument } from "pdf-lib";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Contract } from "./types";

const serverMocks = vi.hoisted(() => ({
  createContractForDocument: vi.fn(),
  createContractForInspection: vi.fn(),
  downloadFromContracts: vi.fn(),
  getContract: vi.fn(),
  getInspectionRef: vi.fn(),
  isContractEsignConfigured: vi.fn(() => true),
  listContracts: vi.fn(),
  markContractSent: vi.fn(),
  markContractSigned: vi.fn(),
  storeContractPdf: vi.fn(),
  storeSignaturePng: vi.fn(),
}));
const automationMocks = vi.hoisted(() => ({
  afterDocumentSent: vi.fn().mockResolvedValue({ signInviteSent: false }),
  afterDocumentSigned: vi.fn().mockResolvedValue({ depositEmailed: false }),
}));
const emailMocks = vi.hoisted(() => ({ sendExecutedContractEmail: vi.fn() }));
const pdfMocks = vi.hoisted(() => ({ generateContractPdf: vi.fn() }));

vi.mock("./server", () => serverMocks);
vi.mock("./automation", () => automationMocks);
vi.mock("./email", () => emailMocks);
vi.mock("./pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pdf")>()),
  generateContractPdf: pdfMocks.generateContractPdf,
}));

import { createContractRouteHandlers, createSignRouteHandlers } from "./routes";
import { createSignToken } from "./tokens";

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const INSPECTION_ID = "22222222-2222-4222-8222-222222222222";
const SIGNATURE_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3qkAAAAASUVORK5CYII=";
const provider = {
  legalName: "WalterSignal LLC",
  shortName: "WalterSignal",
  signatoryName: "Mike Finneran",
  signatoryTitle: "Founder",
  email: "mike@example.com",
  phone: "555-0100",
};

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: CONTRACT_ID,
    inspection_id: null,
    title: "DoinZip Agreement",
    source_pdf_path: `${CONTRACT_ID}/source.pdf`,
    signer_email: "signer@example.com",
    signer_address: null,
    status: "sent",
    signer_name: "Original Signer",
    signer_title: null,
    signature_path: null,
    pdf_path: null,
    signed_at: null,
    signed_ip: null,
    signed_user_agent: null,
    audit_method: null,
    ...overrides,
  };
}

const inspection = {
  id: INSPECTION_ID,
  inspection_slug: "test",
  prospect_name: "Taylor Example",
  prospect_company: "Example Co",
  prospect_email: "taylor@example.com",
  office_address: "123 Main Street",
  walkthrough_date: "2026-10-01",
  visits_per_week: 1,
  scope_inclusions: "Floors",
  scope_exclusions: null,
  cleaning_days: "Friday",
  clean_window: "Evening",
  target_start: "2026-11-01",
  consumables_provided_by: "Client",
  quote_base_monthly: 1000,
  quote_rate_per_sqft: null,
  cleanable_sqft: null,
  status: "accepted",
};

async function sourcePdf(pageCount = 2): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) pdf.addPage([300 + index, 400]);
  return pdf.save();
}

async function token(): Promise<string> {
  return createSignToken(CONTRACT_ID);
}

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.com/api/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Vitest" },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env.AUTH_SECRET = "routes-spec-secret-with-enough-entropy";
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CONTRACT_NOTIFY_EMAIL;
  serverMocks.isContractEsignConfigured.mockReturnValue(true);
  serverMocks.storeSignaturePng.mockResolvedValue(`${CONTRACT_ID}/signature.png`);
  serverMocks.storeContractPdf.mockResolvedValue(`${CONTRACT_ID}/agreement.pdf`);
  serverMocks.markContractSent.mockImplementation(async () => contract({ status: "sent" }));
  serverMocks.markContractSigned.mockImplementation(async (_id, input) =>
    contract({
      status: "signed",
      signer_name: input.signerName,
      signer_address: input.signerAddress ?? null,
      signature_path: input.signaturePath,
      pdf_path: input.pdfPath,
      signed_at: input.signedAtIso,
    }),
  );
  emailMocks.sendExecutedContractEmail.mockResolvedValue({ ok: true });
  pdfMocks.generateContractPdf.mockResolvedValue(Buffer.from("%PDF-generated"));
});

describe("document contract routes", () => {
  it("creates a document contract from an authorized multipart upload", async () => {
    const bytes = await sourcePdf(1);
    serverMocks.createContractForDocument.mockResolvedValue(contract());
    const form = new FormData();
    form.set("file", new File([Uint8Array.from(bytes)], "agreement.pdf", { type: "application/pdf" }));
    form.set("title", "DoinZip Agreement");
    form.set("signerName", "Taylor Example");
    form.set("signerEmail", "taylor@example.com");
    const handlers = createContractRouteHandlers({
      provider,
      authorize: () => true,
      authorizeUpload: () => true,
    });

    const response = await handlers.POST(
      new Request("https://example.com/api/contract", { method: "POST", body: form }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(serverMocks.createContractForDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "DoinZip Agreement",
        signerName: "Taylor Example",
        signerEmail: "taylor@example.com",
        pdfBytes: expect.any(Uint8Array),
      }),
    );
    expect(body.signUrl).toMatch(/^https:\/\/example\.com\/sign\?token=/);
  });

  it("resolves CRM links and lets an explicit opportunity override the resolved one", async () => {
    const resolvedOpportunity = "33333333-3333-4333-8333-333333333333";
    const explicitOpportunity = "44444444-4444-4444-8444-444444444444";
    const resolve = vi.fn().mockResolvedValue({
      accountId: "55555555-5555-4555-8555-555555555555",
      contactId: "66666666-6666-4666-8666-666666666666",
      opportunityId: resolvedOpportunity,
    });
    serverMocks.createContractForDocument.mockResolvedValue(contract());
    const form = new FormData();
    form.set("file", new File([Uint8Array.from(await sourcePdf(1))], "agreement.pdf"));
    form.set("title", "DoinZip Agreement");
    form.set("signerName", "Taylor Example");
    form.set("signerEmail", "taylor@example.com");
    form.set("crmOpportunityId", explicitOpportunity);
    const handlers = createContractRouteHandlers({
      provider,
      authorize: () => true,
      authorizeUpload: () => true,
      automation: { brandName: "WalterSignal", crm: { resolve } },
    });

    const response = await handlers.POST(
      new Request("https://example.com/api/contract", { method: "POST", body: form }),
    );

    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledWith("taylor@example.com");
    expect(serverMocks.createContractForDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        crmAccountId: "55555555-5555-4555-8555-555555555555",
        crmContactId: "66666666-6666-4666-8666-666666666666",
        crmOpportunityId: explicitOpportunity,
      }),
    );
  });

  it("denies uploads when authorizeUpload is absent", async () => {
    const form = new FormData();
    form.set("file", new File(["%PDF-1.7"], "agreement.pdf", { type: "application/pdf" }));
    const handlers = createContractRouteHandlers({ provider, authorize: () => true });

    const response = await handlers.POST(
      new Request("https://example.com/api/contract", { method: "POST", body: form }),
    );

    expect(response.status).toBe(401);
    expect(serverMocks.createContractForDocument).not.toHaveBeenCalled();
  });

  it("rejects a multipart file whose bytes are not a PDF", async () => {
    const form = new FormData();
    form.set("file", new File(["not a pdf"], "agreement.pdf", { type: "application/pdf" }));
    form.set("title", "Agreement");
    form.set("signerName", "Taylor Example");
    form.set("signerEmail", "taylor@example.com");
    const handlers = createContractRouteHandlers({
      provider,
      authorize: () => true,
      authorizeUpload: () => true,
    });

    const response = await handlers.POST(
      new Request("https://example.com/api/contract", { method: "POST", body: form }),
    );

    expect(response.status).toBe(400);
    expect(serverMocks.createContractForDocument).not.toHaveBeenCalled();
  });

  it("loads document signing metadata without reading an inspection", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    const handlers = createSignRouteHandlers({ provider });
    const signToken = await token();

    const response = await handlers.GET(
      new Request(`https://example.com/api/sign?token=${encodeURIComponent(signToken)}`),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      kind: "document",
      title: "DoinZip Agreement",
      documentUrl: expect.stringContaining("&source=1"),
    });
    expect(serverMocks.getInspectionRef).not.toHaveBeenCalled();
  });

  it("appends one page, stores signer address, and emails both recipients", async () => {
    const source = await sourcePdf(2);
    serverMocks.getContract.mockResolvedValue(contract());
    serverMocks.downloadFromContracts.mockResolvedValue(source);
    const handlers = createSignRouteHandlers({ provider });

    const response = await handlers.POST(
      jsonRequest({
        token: await token(),
        signerName: "Taylor Example",
        signerAddress: "123 Main Street\nFort Wayne, IN",
        signatureData: SIGNATURE_DATA,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, emailed: true });
    const storedPdf = serverMocks.storeContractPdf.mock.calls[0]?.[1] as Uint8Array;
    expect((await PDFDocument.load(storedPdf)).getPageCount()).toBe(3);
    expect(serverMocks.markContractSigned).toHaveBeenCalledWith(
      CONTRACT_ID,
      expect.objectContaining({ signerAddress: "123 Main Street\nFort Wayne, IN" }),
    );
    expect(emailMocks.sendExecutedContractEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["signer@example.com", "mike@waltersignal.io"],
        title: "DoinZip Agreement",
        signerName: "Taylor Example",
      }),
    );
  });

  it("requires a mailing address for document signing", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    const handlers = createSignRouteHandlers({ provider });

    const response = await handlers.POST(
      jsonRequest({
        token: await token(),
        signerName: "Taylor Example",
        signatureData: SIGNATURE_DATA,
      }),
    );

    expect(response.status).toBe(400);
    expect(serverMocks.storeContractPdf).not.toHaveBeenCalled();
  });

  it("keeps signing successful when executed-copy email fails", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    serverMocks.downloadFromContracts.mockResolvedValue(await sourcePdf(1));
    emailMocks.sendExecutedContractEmail.mockRejectedValue(new Error("Resend unavailable"));
    const handlers = createSignRouteHandlers({ provider });

    const response = await handlers.POST(
      jsonRequest({
        token: await token(),
        signerName: "Taylor Example",
        signerAddress: "123 Main Street",
        signatureData: SIGNATURE_DATA,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, emailed: false });
  });
});

describe("document contract hardening", () => {
  function uploadForm(bytes: Uint8Array, email = "taylor@example.com"): FormData {
    const form = new FormData();
    form.set("file", new File([Uint8Array.from(bytes)], "agreement.pdf", { type: "" }));
    form.set("title", "DoinZip Agreement");
    form.set("signerName", "Taylor Example");
    form.set("signerEmail", email);
    return form;
  }
  const staff = () =>
    createContractRouteHandlers({ provider, authorize: () => true, authorizeUpload: () => true });
  const upload = (form: FormData, headers?: Record<string, string>) =>
    new Request("https://example.com/api/contract", { method: "POST", body: form, headers });
  const signBody = async (overrides: Record<string, unknown> = {}) =>
    jsonRequest({
      token: await token(),
      signerName: "Taylor Example",
      signerAddress: "123 Main Street",
      signatureData: SIGNATURE_DATA,
      ...overrides,
    });

  it("denies uploads when authorize passes but authorizeUpload refuses", async () => {
    const handlers = createContractRouteHandlers({
      provider,
      authorize: () => true,
      authorizeUpload: () => false,
    });
    const response = await handlers.POST(upload(uploadForm(await sourcePdf(1))));
    expect(response.status).toBe(401);
    expect(serverMocks.createContractForDocument).not.toHaveBeenCalled();
  });

  it("refuses a PDF header on bytes pdf-lib cannot parse", async () => {
    const junk = new TextEncoder().encode("%PDF-1.7 not really a pdf");
    const response = await staff().POST(upload(uploadForm(junk)));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/could not be read/);
    expect(serverMocks.createContractForDocument).not.toHaveBeenCalled();
  });

  it("returns 413 from content-length before reading an oversized body", async () => {
    const response = await staff().POST(
      upload(uploadForm(await sourcePdf(1)), { "content-length": String(5 * 1024 * 1024) }),
    );
    expect(response.status).toBe(413);
  });

  it("rejects a signer email that would expand to several recipients", async () => {
    const response = await staff().POST(
      upload(uploadForm(await sourcePdf(1), "a@b.co,c@d.com")),
    );
    expect(response.status).toBe(400);
  });

  it("streams the source PDF for a document token and refuses it for inspections", async () => {
    const source = await sourcePdf(2);
    serverMocks.downloadFromContracts.mockResolvedValue(source);
    serverMocks.getContract.mockResolvedValue(contract());
    const handlers = createSignRouteHandlers({ provider });
    const url = `https://example.com/api/sign?token=${await token()}&source=1`;

    const response = await handlers.GET(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(source);

    serverMocks.getContract.mockResolvedValue(
      contract({ inspection_id: INSPECTION_ID, source_pdf_path: null }),
    );
    expect((await handlers.GET(new Request(url))).status).toBe(401);

    serverMocks.getContract.mockResolvedValue(contract({ status: "void" }));
    expect((await handlers.GET(new Request(url))).status).toBe(401);
  });

  it("stores artifacts under a per-attempt id", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    serverMocks.downloadFromContracts.mockResolvedValue(await sourcePdf(1));
    await createSignRouteHandlers({ provider }).POST(await signBody());
    const attempt = serverMocks.storeSignaturePng.mock.calls[0]?.[2];
    expect(attempt).toMatch(/^[0-9a-f-]{36}$/);
    expect(serverMocks.storeContractPdf.mock.calls[0]?.[2]).toBe(attempt);
  });

  it("does not mark signed when the signature cannot be stored", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    serverMocks.downloadFromContracts.mockResolvedValue(await sourcePdf(1));
    serverMocks.storeSignaturePng.mockResolvedValue(null);
    const response = await createSignRouteHandlers({ provider }).POST(await signBody());
    expect(response.status).toBe(500);
    expect(serverMocks.markContractSigned).not.toHaveBeenCalled();
    expect(emailMocks.sendExecutedContractEmail).not.toHaveBeenCalled();
  });

  it("reports the winning execution and sends no email when a concurrent attempt won", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    serverMocks.downloadFromContracts.mockResolvedValue(await sourcePdf(1));
    serverMocks.markContractSigned.mockResolvedValue(
      contract({
        status: "signed",
        pdf_path: `${CONTRACT_ID}/agreement-other.pdf`,
        signed_at: "2026-10-22T15:30:00.000Z",
      }),
    );
    const response = await createSignRouteHandlers({ provider }).POST(await signBody());
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, alreadySigned: true, signedAt: "2026-10-22T15:30:00.000Z" });
    expect(emailMocks.sendExecutedContractEmail).not.toHaveBeenCalled();
  });

  it("refuses a contract voided between the read and the update", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    serverMocks.downloadFromContracts.mockResolvedValue(await sourcePdf(1));
    serverMocks.markContractSigned.mockResolvedValue(contract({ status: "void" }));
    const response = await createSignRouteHandlers({ provider }).POST(await signBody());
    expect(response.status).toBe(401);
    expect(emailMocks.sendExecutedContractEmail).not.toHaveBeenCalled();
  });

  it("still emails when the UPDATE committed but its response was lost", async () => {
    serverMocks.downloadFromContracts.mockResolvedValue(await sourcePdf(1));
    serverMocks.markContractSigned.mockResolvedValue(null);
    serverMocks.getContract
      .mockResolvedValueOnce(contract())
      .mockResolvedValueOnce(
        contract({ status: "signed", pdf_path: `${CONTRACT_ID}/agreement.pdf`, signed_at: "2026-10-22T15:30:00.000Z" }),
      );
    emailMocks.sendExecutedContractEmail.mockResolvedValue({ ok: true });
    const body = await (await createSignRouteHandlers({ provider }).POST(await signBody())).json();
    expect(body).toMatchObject({ ok: true, emailed: true });
    expect(emailMocks.sendExecutedContractEmail).toHaveBeenCalledOnce();
  });

  it("returns 500 when the UPDATE failed and the row is still open", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    serverMocks.downloadFromContracts.mockResolvedValue(await sourcePdf(1));
    serverMocks.markContractSigned.mockResolvedValue(null);
    const response = await createSignRouteHandlers({ provider }).POST(await signBody());
    expect(response.status).toBe(500);
    expect(emailMocks.sendExecutedContractEmail).not.toHaveBeenCalled();
  });

  it("rejects a mailing address with more lines than the signature page holds", async () => {
    serverMocks.getContract.mockResolvedValue(contract());
    const response = await createSignRouteHandlers({ provider }).POST(
      await signBody({ signerAddress: Array.from({ length: 9 }, (_, i) => `Line ${i}`).join("\n") }),
    );
    expect(response.status).toBe(400);
  });

  it("de-duplicates recipients case-insensitively", async () => {
    process.env.CONTRACT_NOTIFY_EMAIL = "Signer@Example.com";
    serverMocks.getContract.mockResolvedValue(contract());
    serverMocks.downloadFromContracts.mockResolvedValue(await sourcePdf(1));
    await createSignRouteHandlers({ provider }).POST(await signBody());
    expect(emailMocks.sendExecutedContractEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["signer@example.com"] }),
    );
  });
});

describe("inspection contract regression", () => {
  it("keeps the generated agreement GET and POST flow", async () => {
    const inspectionContract = contract({
      inspection_id: INSPECTION_ID,
      title: null,
      source_pdf_path: null,
      signer_email: null,
    });
    serverMocks.getContract.mockResolvedValue(inspectionContract);
    serverMocks.getInspectionRef.mockResolvedValue(inspection);
    const handlers = createSignRouteHandlers({ provider });
    const signToken = await token();

    const getResponse = await handlers.GET(
      new Request(`https://example.com/api/sign?token=${encodeURIComponent(signToken)}`),
    );
    expect(await getResponse.json()).toMatchObject({
      ok: true,
      kind: "agreement",
      company: "Example Co",
      address: "123 Main Street",
      agreement: expect.any(Object),
    });

    const postResponse = await handlers.POST(
      jsonRequest({
        token: signToken,
        signerName: "Taylor Example",
        signerTitle: "Manager",
        signatureData: SIGNATURE_DATA,
      }),
    );
    expect(await postResponse.json()).toEqual({
      ok: true,
      signedAt: expect.any(String),
      company: "Example Co",
    });
    expect(serverMocks.getInspectionRef).toHaveBeenCalledWith(INSPECTION_ID);
    expect(pdfMocks.generateContractPdf).toHaveBeenCalledOnce();
  });
});
