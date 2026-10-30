import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientConfig } from "@waltersignal/bananaforce-core";

const verifyOtp = vi.fn();
const isSupabaseConfigured = vi.fn();
const signOut = vi.fn();

vi.mock("@waltersignal/bananaforce-data-supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { verifyOtp, signOut } }),
}));
vi.mock("@waltersignal/bananaforce-data-supabase/client", () => ({
  isSupabaseConfigured: () => isSupabaseConfigured(),
}));

const { createStaffLinkRoute } = await import("./staff-link-route");

const ORIGIN = "https://app.example.com";

function config(staffHome?: string, googleWorkspaceDomain?: string): ClientConfig {
  return {
    slug: "test",
    domain: "app.example.com",
    brand: { name: "Test", colors: { primary: "#000", primaryDark: "#000" } },
    data: { adapter: "supabase", projectRef: "abc" },
    auth: {
      staff: {
        provider: "supabase",
        ...(staffHome ? { staffHome } : {}),
        ...(googleWorkspaceDomain ? { googleWorkspaceDomain } : {}),
      },
    },
    modules: [],
  } as ClientConfig;
}

function call(route: (r: Request) => Promise<Response>, query: string) {
  return route(new Request(`${ORIGIN}/auth/confirm${query}`));
}

function target(res: Response): URL {
  return new URL(res.headers.get("location") ?? "");
}

describe("createStaffLinkRoute", () => {
  beforeEach(() => {
    verifyOtp.mockReset();
    signOut.mockReset();
    isSupabaseConfigured.mockReset();
    isSupabaseConfigured.mockReturnValue(true);
  });

  it("verifies a magiclink hash and lands on staffHome", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { email: "a@example.com" } }, error: null });
    const res = await call(createStaffLinkRoute(config("/crm")), "?token_hash=h1&type=magiclink");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "h1" });
    expect(target(res).origin).toBe(ORIGIN);
    expect(target(res).pathname).toBe("/crm");
  });

  it.each(["", "?type=magiclink", "?token_hash=h1", "?token_hash=h1&type=recovery", "?token_hash=h1&type=invite"])(
    "refuses %s without calling Supabase",
    async (query) => {
      const res = await call(createStaffLinkRoute(config("/crm")), query);
      expect(target(res).pathname).toBe("/admin/login");
      expect(target(res).searchParams.get("error")).toBe("invalid_sign_in_link");
      expect(verifyOtp).not.toHaveBeenCalled();
    },
  );

  it("reports an unconfigured Supabase distinctly", async () => {
    isSupabaseConfigured.mockReturnValue(false);
    const res = await call(createStaffLinkRoute(config()), "?token_hash=h1&type=magiclink");
    expect(target(res).searchParams.get("error")).toBe("supabase_not_configured");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("reports a used or expired link", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "Email link is invalid or has expired" } });
    const res = await call(createStaffLinkRoute(config("/crm")), "?token_hash=h1&type=magiclink");
    expect(target(res).searchParams.get("error")).toBe("sign_in_link_expired");
  });

  it("applies googleWorkspaceDomain and signs out an address on another domain", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { email: "someone@gmail.com" } }, error: null });
    const res = await call(createStaffLinkRoute(config("/crm", "example.com")), "?token_hash=h1&type=magiclink");
    expect(target(res).searchParams.get("error")).toBe("wrong_domain");
    expect(signOut).toHaveBeenCalled();
  });

  it("ignores a redirect target supplied in the query string", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { email: "a@example.com" } }, error: null });
    const res = await call(
      createStaffLinkRoute(config("/crm")),
      "?token_hash=h1&type=magiclink&next=https://evil.example.com/steal",
    );
    expect(target(res).origin).toBe(ORIGIN);
    expect(target(res).pathname).toBe("/crm");
  });
});
