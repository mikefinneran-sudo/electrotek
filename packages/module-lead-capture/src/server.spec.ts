import { beforeEach, describe, expect, it, vi } from "vitest";

const { configured, rpc, storageFrom, upload } = vi.hoisted(() => ({
  configured: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@waltersignal/bananaforce-data-supabase/client", () => ({
  isSupabaseConfigured: () => configured(),
}));
vi.mock("@waltersignal/bananaforce-data-supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    rpc,
    storage: { from: storageFrom },
  }),
}));

const { insertLead } = await import("./server");

const lead = {
  name: "Ada",
  company: "ElectroTek",
  email: "ada@example.com",
  phone: "555-0100",
  office: "",
  notes: "Narrative",
  source: "unit-test",
  metadata: { inquiry_type: "Forensic investigation" },
};

describe("insertLead attachment handling", () => {
  beforeEach(() => {
    configured.mockReset().mockReturnValue(true);
    rpc.mockReset().mockResolvedValue({ data: null, error: null });
    upload.mockReset().mockResolvedValue({ error: null });
    storageFrom.mockReset().mockReturnValue({ upload });
  });

  it("keeps no-file submissions on the existing RPC and never touches Storage", async () => {
    await expect(insertLead(lead)).resolves.toEqual({ ok: true });
    expect(storageFrom).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("submit_lead", expect.any(Object));
  });

  it("uploads files and sends their metadata through the attachment-aware RPC", async () => {
    rpc.mockResolvedValue({ data: "3a4d8197-98d5-42d2-9699-a733b9992fe5", error: null });
    const file = new File(["pdf"], "scene report.pdf", { type: "application/pdf" });
    const result = await insertLead(lead, [file]);

    expect(result.ok).toBe(true);
    expect(storageFrom).toHaveBeenCalledWith("lead-attachments");
    expect(upload).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "submit_lead_with_attachments",
      expect.objectContaining({
        p_attachments: [
          expect.objectContaining({
            file_name: "scene report.pdf",
            mime_type: "application/pdf",
            size_bytes: 3,
          }),
        ],
      }),
    );
  });

  it("reports a missing Storage bucket as setupRequired", async () => {
    upload.mockResolvedValue({
      error: { message: "Bucket not found", statusCode: "404" },
    });
    const file = new File(["pdf"], "report.pdf", { type: "application/pdf" });
    const result = await insertLead(lead, [file]);

    expect(result).toMatchObject({ ok: false, setupRequired: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the existing setupRequired response when Supabase is unconfigured", async () => {
    configured.mockReturnValue(false);
    const result = await insertLead(lead);
    expect(result).toMatchObject({ ok: false, setupRequired: true });
    expect(storageFrom).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
