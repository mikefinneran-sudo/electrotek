import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

describe("verifyTurnstile", () => {
  it("is a no-op when no secret is configured", async () => {
    const fetchImpl = vi.fn();
    await expect(
      verifyTurnstile("", "203.0.113.10", { secret: "", fetchImpl }),
    ).resolves.toEqual({ ok: true, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed for a missing token when configured", async () => {
    const fetchImpl = vi.fn();
    const result = await verifyTurnstile("", "203.0.113.10", {
      secret: "configured-secret",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when siteverify is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await verifyTurnstile("valid-looking-token", "203.0.113.10", {
      secret: "configured-secret",
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, skipped: false });
  });

  it("accepts only a successful siteverify response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await verifyTurnstile("passed-token", "203.0.113.10", {
      secret: "configured-secret",
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, skipped: false });
  });

  it("rejects an invalid siteverify response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await verifyTurnstile("bad-token", "203.0.113.10", {
      secret: "configured-secret",
      fetchImpl,
    });
    expect(result).toMatchObject({
      ok: false,
      skipped: false,
      errorCodes: ["invalid-input-response"],
    });
  });
});
