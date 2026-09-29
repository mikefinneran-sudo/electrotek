import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientConfig } from "@waltersignal/bananaforce-core";

const exchangeCodeForSession = vi.fn();
const isSupabaseConfigured = vi.fn();
const signOut = vi.fn();

vi.mock("@waltersignal/bananaforce-data-supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession, signOut } }),
}));
vi.mock("@waltersignal/bananaforce-data-supabase/client", () => ({
  isSupabaseConfigured: () => isSupabaseConfigured(),
}));

const { createOAuthCallbackRoute } = await import("./oauth-callback-route");

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
  return route(new Request(`${ORIGIN}/auth/callback${query}`));
}

/** Where a redirect Response points, as a URL. */
function target(res: Response): URL {
  return new URL(res.headers.get("location") ?? "");
}

describe("createOAuthCallbackRoute", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    signOut.mockReset();
    isSupabaseConfigured.mockReset();
    isSupabaseConfigured.mockReturnValue(true);
  });

  it("forwards Google's own error rather than reporting a missing code", async () => {
    const res = await call(createOAuthCallbackRoute(config()), "?error=access_denied");
    const url = target(res);
    expect(url.pathname).toBe("/admin/login");
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects a callback with no code", async () => {
    const res = await call(createOAuthCallbackRoute(config()), "");
    expect(target(res).searchParams.get("error")).toBe("missing_oauth_code");
  });

  it("reports an unconfigured Supabase distinctly", async () => {
    isSupabaseConfigured.mockReturnValue(false);
    const res = await call(createOAuthCallbackRoute(config()), "?code=abc");
    expect(target(res).searchParams.get("error")).toBe("supabase_not_configured");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("reports a failed code exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    const res = await call(createOAuthCallbackRoute(config()), "?code=abc");
    expect(target(res).searchParams.get("error")).toBe("oauth_exchange_failed");
  });

  it("exchanges the code and lands on the configured staffHome", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { email: "a@example.com" } }, error: null });
    const res = await call(createOAuthCallbackRoute(config("/crm")), "?code=abc");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    const url = target(res);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/crm");
    expect(url.searchParams.get("error")).toBeNull();
  });

  it("falls back to /admin when no staffHome is configured", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { email: "a@example.com" } }, error: null });
    const res = await call(createOAuthCallbackRoute(config()), "?code=abc");
    expect(target(res).pathname).toBe("/admin");
  });

  describe("googleWorkspaceDomain enforcement (External consent screens)", () => {
    const DOMAIN = "electrotekconsultants.com";

    function signsInAs(email: string) {
      exchangeCodeForSession.mockResolvedValue({ data: { user: { email } }, error: null });
    }

    it("admits an address on the required domain", async () => {
      signsInAs("jvm@electrotekconsultants.com");
      const res = await call(createOAuthCallbackRoute(config("/crm", DOMAIN)), "?code=abc");
      expect(target(res).pathname).toBe("/crm");
      expect(signOut).not.toHaveBeenCalled();
    });

    it("is case-insensitive about the address", async () => {
      signsInAs("JVM@ElectroTekConsultants.COM");
      const res = await call(createOAuthCallbackRoute(config("/crm", DOMAIN)), "?code=abc");
      expect(target(res).pathname).toBe("/crm");
    });

    it("rejects a valid Google account on another domain, and signs it out", async () => {
      signsInAs("someone@gmail.com");
      const res = await call(createOAuthCallbackRoute(config("/crm", DOMAIN)), "?code=abc");
      expect(target(res).searchParams.get("error")).toBe("wrong_domain");
      expect(signOut).toHaveBeenCalled();
    });

    // The check must compare the domain, not merely look for the string
    // anywhere in the address -- attacker@electrotekconsultants.com.evil.test
    // and electrotekconsultants.com@evil.test both contain it.
    it.each([
      "attacker@electrotekconsultants.com.evil.test",
      "electrotekconsultants.com@evil.test",
      "attacker@evil-electrotekconsultants.com",
      "attacker@sub.electrotekconsultants.com",
    ])("rejects lookalike address %s", async (email) => {
      signsInAs(email);
      const res = await call(createOAuthCallbackRoute(config("/crm", DOMAIN)), "?code=abc");
      expect(target(res).searchParams.get("error")).toBe("wrong_domain");
    });

    it("rejects a session with no email at all", async () => {
      exchangeCodeForSession.mockResolvedValue({ data: { user: {} }, error: null });
      const res = await call(createOAuthCallbackRoute(config("/crm", DOMAIN)), "?code=abc");
      expect(target(res).searchParams.get("error")).toBe("wrong_domain");
    });

    it("skips the check entirely when no domain is configured (Internal screens)", async () => {
      signsInAs("anyone@anywhere.test");
      const res = await call(createOAuthCallbackRoute(config("/crm")), "?code=abc");
      expect(target(res).pathname).toBe("/crm");
      expect(signOut).not.toHaveBeenCalled();
    });
  });

  // staffHome comes from server-side config, never from the request, so a
  // crafted callback cannot bounce a signed-in user off-origin.
  it("ignores a redirect target supplied in the query string", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { email: "a@example.com" } }, error: null });
    const res = await call(
      createOAuthCallbackRoute(config("/crm")),
      "?code=abc&redirectTo=https://evil.example.com/steal",
    );
    expect(target(res).origin).toBe(ORIGIN);
    expect(target(res).pathname).toBe("/crm");
  });
});
