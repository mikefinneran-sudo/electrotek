import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "pdf-lib";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  appendSignaturePage,
  checkSourcePdf,
  MAX_SOURCE_PAGES,
  type DocumentSignatureDetails,
} from "./document-pdf";
import { decodeSignaturePng } from "./pdf";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3qkAAAAASUVORK5CYII=",
    "base64",
  ),
);

const provider = {
  legalName: "WalterSignal LLC",
  shortName: "WalterSignal",
  signatoryName: "Mike Finneran",
  signatoryTitle: "Founder",
  email: "mike@example.com",
  phone: "555-0100",
};

async function sourcePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  pdf.addPage([500, 600]);
  pdf.addPage([612, 792]);
  return pdf.save();
}

function details(overrides: Partial<DocumentSignatureDetails> = {}): DocumentSignatureDetails {
  return {
    contractId: "11111111-1111-4111-8111-111111111111",
    title: "DoinZip Agreement",
    provider,
    signerName: "Taylor Example",
    signerAddress: "123 Main Street\nFort Wayne, IN 46802",
    signaturePng: PNG,
    signedAtIso: "2026-10-22T15:30:00.000Z",
    ip: "203.0.113.10",
    userAgent: "Vitest Browser",
    method: "Client e-signature link",
    ...overrides,
  };
}

function signaturePageOperators(pdf: PDFDocument): string {
  const contents = pdf.getPages().at(-1)?.node.Contents();
  const entries = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return entries
    .map((entry) => {
      const stream = pdf.context.lookup(entry);
      if (!(stream instanceof PDFRawStream)) throw new Error("expected a raw content stream");
      return new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    })
    .join("\n");
}

function winAnsiHex(value: string): string {
  return Buffer.from(value, "latin1").toString("hex").toUpperCase();
}

describe("appendSignaturePage", () => {
  it("preserves the source pages and appends one signature page with audit text", async () => {
    const bytes = await appendSignaturePage(await sourcePdf(), details());
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
    expect(pdf.getPage(1).getSize()).toEqual({ width: 500, height: 600 });
    expect(pdf.getPage(2).getSize()).toEqual({ width: 612, height: 792 });
    expect(pdf.getPage(3).getSize()).toEqual({ width: 612, height: 792 });

    const operators = signaturePageOperators(pdf).toUpperCase();
    expect(operators).toContain(winAnsiHex("Taylor Example"));
    expect(operators).toContain(winAnsiHex("123 Main Street"));
    expect(operators).toContain(winAnsiHex("11111111-1111-4111-8111-111111111111"));
  });

  it("prints the human date without a replacement character", async () => {
    const pdf = await PDFDocument.load(await appendSignaturePage(await sourcePdf(), details()));
    const operators = signaturePageOperators(pdf).toUpperCase();
    expect(operators).toContain(winAnsiHex("Date: October 22, 2026 at 3:30 PM UTC"));
  });

  it("maps the narrow no-break space older ICU puts before AM/PM to a space", async () => {
    const pdf = await PDFDocument.load(
      await appendSignaturePage(await sourcePdf(), details({ signerName: "Pat\u202fSigner" })),
    );
    expect(signaturePageOperators(pdf).toUpperCase()).toContain(winAnsiHex("Pat Signer"));
  });

  it("keeps document-level structures of the source", async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    source.setTitle("Original title");
    source.getForm().createTextField("client.name").addToPage(source.getPage(0));
    const out = await PDFDocument.load(
      await appendSignaturePage(await source.save(), details()),
    );
    expect(out.getTitle()).toBe("Original title");
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(["client.name"]);
    expect(out.getPageCount()).toBe(2);
  });

  it("sanitizes unsupported text without throwing", async () => {
    await expect(
      appendSignaturePage(
        await sourcePdf(),
        details({ signerName: "Renée — Signer 😊", title: "Agreement 😊" }),
      ),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("checkSourcePdf", () => {
  it("accepts a parseable PDF and refuses junk and oversized documents", async () => {
    expect(await checkSourcePdf(await sourcePdf())).toBeNull();
    expect(await checkSourcePdf(new TextEncoder().encode("%PDF-1.7 junk"))).toMatch(/could not be read/);
    const big = await PDFDocument.create();
    for (let i = 0; i <= MAX_SOURCE_PAGES; i += 1) big.addPage([10, 10]);
    expect(await checkSourcePdf(await big.save())).toMatch(/maximum is 200/);
  });
});

describe("decodeSignaturePng", () => {
  it("accepts a real PNG and refuses non-PNG bytes and oversized dimensions", () => {
    const b64 = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    expect(decodeSignaturePng(b64(PNG))).toEqual(PNG);
    expect(decodeSignaturePng(b64(new TextEncoder().encode("not a png at all, really")))).toBeNull();
    const huge = Uint8Array.from(PNG);
    new DataView(huge.buffer).setUint32(16, 100_000);
    expect(decodeSignaturePng(b64(huge))).toBeNull();
  });

  it("refuses a PNG whose IDAT inflates past its declared dimensions", () => {
    const chunk = (type: string, data: Uint8Array) => {
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      out.write(type, 4, "latin1");
      Buffer.from(data).copy(out, 8);
      return out;
    };
    const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
    const bomb = Buffer.concat([
      PNG.subarray(0, 8),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.alloc(5_000_000))),
      chunk("IEND", new Uint8Array()),
    ]);
    expect(decodeSignaturePng(`data:image/png;base64,${bomb.toString("base64")}`)).toBeNull();
  });
});
