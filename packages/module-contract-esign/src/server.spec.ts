import { beforeEach, describe, expect, it, vi } from "vitest";

const updates = vi.hoisted(() => [] as Record<string, unknown>[]);
const filters = vi.hoisted(() => [] as unknown[][]);
const uploads = vi.hoisted(() => [] as string[]);

vi.mock("@waltersignal/bananaforce-data-supabase/server-helpers", () => {
  const query = {
    update(payload: Record<string, unknown>) {
      updates.push(payload);
      return query;
    },
    eq: () => query,
    in: (...args: unknown[]) => {
      filters.push(args);
      return query;
    },
    select: () => query,
    maybeSingle: async () => ({ data: { id: "c1", status: "signed" }, error: null }),
  };
  const client = {
    from: () => query,
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { error: null };
        },
      }),
    },
  };
  return { getServiceClientOrNull: () => client, warnSupabase: () => {} };
});

import { markContractSigned, storeContractPdf, storeSignaturePng } from "./server";

beforeEach(() => {
  updates.length = 0;
  filters.length = 0;
  uploads.length = 0;
});

describe("markContractSigned", () => {
  it("omits signer_address for inspection contracts so pre-0004 databases still accept it", async () => {
    await markContractSigned("c1", { signerName: "A", signaturePath: null, pdfPath: null });
    expect(updates[0]).not.toHaveProperty("signer_address");
  });

  it("only signs an open contract, so a void one is never revived", async () => {
    await markContractSigned("c1", { signerName: "A", signaturePath: null, pdfPath: null });
    expect(filters).toEqual([["status", ["pending", "sent"]]]);
  });

  it("writes signer_address for document contracts", async () => {
    await markContractSigned("c1", {
      signerName: "A",
      signerAddress: "1 Main St",
      signaturePath: "c1/s.png",
      pdfPath: "c1/a.pdf",
    });
    expect(updates[0]).toMatchObject({ signer_address: "1 Main St" });
  });
});

describe("artifact paths", () => {
  it("keeps the fixed inspection paths and gives document attempts their own", async () => {
    await storeSignaturePng("c1", new Uint8Array());
    await storeContractPdf("c1", new Uint8Array());
    await storeSignaturePng("c1", new Uint8Array(), "t1");
    await storeContractPdf("c1", new Uint8Array(), "t1");
    expect(uploads).toEqual([
      "c1/signature.png",
      "c1/agreement.pdf",
      "c1/signature-t1.png",
      "c1/agreement-t1.pdf",
    ]);
  });
});
