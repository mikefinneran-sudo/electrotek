import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { oauthErrorMessage, OAUTH_ERROR_TEXT } from "./oauth-error-text";

/**
 * Reason codes the callback route actually emits, read out of its source.
 *
 * A hardcoded list here would be decorative: adding a fifth reason to the route
 * and forgetting the map is precisely the drift this test claims to catch, and a
 * hardcoded list cannot catch it. Derive from the source so the claim is true.
 * Only string literals are collected -- `loginRedirect(oauthError)` forwards
 * Google's own codes, which are unbounded and handled by the fallback.
 */
function reasonsEmittedByRoute(): string[] {
  const routeFile = fileURLToPath(new URL("./oauth-callback-route.ts", import.meta.url));
  const source = readFileSync(routeFile, "utf8");
  return [...source.matchAll(/loginRedirect\("([^"]+)"\)/g)].map((m) => m[1]);
}

describe("oauthErrorMessage", () => {
  it("maps every reason the callback route actually emits", () => {
    const emitted = reasonsEmittedByRoute();
    // Guard the guard: if the regex stops matching, the loop below would pass
    // vacuously over an empty array.
    expect(emitted.length).toBeGreaterThanOrEqual(3);

    for (const reason of emitted) {
      expect(OAUTH_ERROR_TEXT[reason], `route emits "${reason}" with no mapping`).toBeTruthy();
      expect(oauthErrorMessage(reason)).toBe(OAUTH_ERROR_TEXT[reason]);
    }
  });

  it("maps Google's own access_denied", () => {
    expect(oauthErrorMessage("access_denied")).toBe("Google sign-in was cancelled.");
  });

  it("maps the Google codes that actually occur, including org_internal", () => {
    // org_internal is what an outside-domain account gets against an Internal
    // consent screen -- the single most likely real failure for a new client.
    expect(oauthErrorMessage("org_internal")).toContain("outside this organisation");
    expect(oauthErrorMessage("admin_policy_enforced")).toContain("policy");
    expect(oauthErrorMessage("redirect_uri_mismatch")).toContain("misconfigured");
  });

  it("never echoes an unmapped reason back into the page", () => {
    expect(oauthErrorMessage("weird_thing")).toBe("Google sign-in failed. Please try again.");
    expect(oauthErrorMessage("some-Code123")).toBe("Google sign-in failed. Please try again.");
  });

  // Reflected-text phishing: an attacker-supplied sentence must never render as
  // though the site said it, even though JSX escaping already stops markup.
  it.each([
    "call 555-0100 to verify your account",
    "Your account is locked. Email attacker@evil.com",
    "<script>alert(1)</script>",
    "contact support at evil.example.com!",
    // Hyphen- and underscore-joined payloads: no spaces or punctuation needed,
    // these passed the earlier /^[a-zA-Z0-9_-]{1,64}$/ charset intact and
    // rendered as a legible phone number and sentence.
    "call-1-800-555-0100",
    "account-suspended-contact-admin-now",
    "your_account_is_locked_call_now",
  ])("refuses to echo prose: %s", (payload) => {
    const out = oauthErrorMessage(payload);
    expect(out).toBe("Google sign-in failed. Please try again.");
    expect(out).not.toContain(payload);
  });

  it("refuses a long token rather than truncating it into the page", () => {
    expect(oauthErrorMessage("A".repeat(65))).toBe("Google sign-in failed. Please try again.");
    expect(oauthErrorMessage("A".repeat(64))).toBe("Google sign-in failed. Please try again.");
  });

  it("handles an empty reason", () => {
    expect(oauthErrorMessage("")).toBe("Google sign-in failed. Please try again.");
  });
});
