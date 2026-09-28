import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { insertLead, sendLeadNotification } = vi.hoisted(() => ({
  insertLead: vi.fn(),
  sendLeadNotification: vi.fn(),
}));

vi.mock("./server", () => ({ insertLead }));
vi.mock("./email", () => ({ sendLeadNotification }));

const { createContactPostHandler } = await import("./routes");
const { resetRateLimit } = await import("./validation");

const previousSecret = process.env.TURNSTILE_SECRET_KEY;

describe("contact route", () => {
  beforeEach(() => {
    resetRateLimit();
    insertLead.mockReset().mockResolvedValue({ ok: true });
    sendLeadNotification.mockReset().mockResolvedValue({ ok: false, skipped: true });
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previousSecret;
    vi.unstubAllGlobals();
  });

  it("enumerates form fields, maps message to notes, and preserves rateLimitCount", async () => {
    const form = new FormData();
    form.set("name", "Ada Lovelace");
    form.set("company", "ElectroTek");
    form.set("email", "ada@example.com");
    form.set("phone", "555-0100");
    form.set("message", "Forensic narrative");
    form.set("inquiry_type", "Forensic investigation");
    form.set("role", "Adjuster");
    form.set("timeline", "Urgent");
    form.set("referral_source", "Colleague");
    form.set("new_client", "Yes");
    form.set("claim_number", "CL-42");

    const POST = createContactPostHandler({ getClientIp: () => "203.0.113.40" });
    const response = await POST(
      new Request("https://example.test/api/contact", { method: "POST", body: form }),
    );

    expect(response.status).toBe(200);
    expect(insertLead).toHaveBeenCalledOnce();
    const [lead, files] = insertLead.mock.calls[0] as [
      { notes: string; office: string; metadata: Record<string, unknown> },
      File[],
    ];
    expect(lead.notes).toBe("Forensic narrative");
    expect(lead.office).toBe("");
    expect(lead.metadata).toMatchObject({
      inquiry_type: "Forensic investigation",
      role: "Adjuster",
      timeline: "Urgent",
      referral_source: "Colleague",
      new_client: "Yes",
      claim_number: "CL-42",
      rateLimitCount: 1,
    });
    expect(lead.metadata).not.toHaveProperty("message");
    expect(lead).not.toHaveProperty("ipHash");
    expect(files).toEqual([]);
  });

  it("skips captcha entirely when its secret is unset", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const POST = createContactPostHandler({ getClientIp: () => "203.0.113.41" });
    const response = await POST(
      new Request("https://example.test/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada", email: "ada@example.com" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed with 403 when configured siteverify is unreachable", async () => {
    process.env.TURNSTILE_SECRET_KEY = "configured-secret";
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchSpy);
    const POST = createContactPostHandler({ getClientIp: () => "203.0.113.42" });
    const response = await POST(
      new Request("https://example.test/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ada",
          email: "ada@example.com",
          "cf-turnstile-response": "token",
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(insertLead).not.toHaveBeenCalled();
  });

  it("fails closed with 403 when a configured captcha token is missing", async () => {
    process.env.TURNSTILE_SECRET_KEY = "configured-secret";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const POST = createContactPostHandler({ getClientIp: () => "203.0.113.44" });
    const response = await POST(
      new Request("https://example.test/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada", email: "ada@example.com" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(insertLead).not.toHaveBeenCalled();
  });

  it("returns honeypot success before captcha or rate limiting", async () => {
    process.env.TURNSTILE_SECRET_KEY = "configured-secret";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const POST = createContactPostHandler({ getClientIp: () => "203.0.113.43" });
    const response = await POST(
      new Request("https://example.test/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ website: "https://spam.test" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(insertLead).not.toHaveBeenCalled();
  });

  it("maps attachment setupRequired failures to 503", async () => {
    insertLead.mockResolvedValue({
      ok: false,
      setupRequired: true,
      error: "Lead attachment storage is not configured.",
    });
    const POST = createContactPostHandler({ getClientIp: () => "203.0.113.45" });
    const response = await POST(
      new Request("https://example.test/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada", email: "ada@example.com" }),
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      setupRequired: true,
    });
  });
});
