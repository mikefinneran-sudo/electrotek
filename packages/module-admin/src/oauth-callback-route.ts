import "server-only";

import { NextResponse } from "next/server";
import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";

/**
 * Second hop of the staff Google SSO flow.
 *
 * The sign-in button in login-form.tsx sends the browser to Google with
 * redirectTo=<origin>/auth/callback. Google returns to Supabase's own
 * /auth/v1/callback, which then redirects here with ?code=. Without this route
 * that redirect lands on a 404 and the code is never exchanged, so the user
 * bounces back to a login page that still shows them signed out.
 *
 * This lived only in apps/waltersignal as a hand-written file. `goat new` never
 * scaffolded it, so every client app generated so far shipped a Google button
 * that could not complete. Factored into the module so app files stay thin and
 * the three copies cannot drift.
 *
 * Exchanging the code establishes a session; it does NOT grant access. The
 * staff allowlist is still what authorizes — getStaffUser() requires a
 * public.staff row whose id matches auth.uid(), so a Google account with no
 * staff row lands on staffHome and is redirected straight back to login.
 */
export function createOAuthCallbackRoute(config: ClientConfig) {
  return async function GET(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);

    function loginRedirect(reason: string) {
      const redirectUrl = new URL("/admin/login", requestUrl.origin);
      redirectUrl.searchParams.set("error", reason);
      return NextResponse.redirect(redirectUrl);
    }

    // Google reports a refused/cancelled consent as ?error= rather than ?code=.
    // Surfacing it beats the generic missing_oauth_code, which reads like a
    // configuration fault when the user simply clicked Cancel.
    const oauthError = requestUrl.searchParams.get("error");
    if (oauthError) return loginRedirect(oauthError);

    const code = requestUrl.searchParams.get("code");
    if (!code) return loginRedirect("missing_oauth_code");
    if (!isSupabaseConfigured()) return loginRedirect("supabase_not_configured");

    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return loginRedirect("oauth_exchange_failed");

    // Domain enforcement for External consent screens.
    //
    // An Internal consent screen restricts sign-in to its own Workspace org, so
    // clients configured that way set no googleWorkspaceDomain and skip this.
    // With External, `hd` on the authorize URL is only a hint to the account
    // chooser -- anyone can strip it -- so the real check has to happen here,
    // after the exchange, against the email Google actually returned.
    //
    // Signing out on rejection matters: the exchange already established a
    // session. Leaving it would strand a signed-in non-staff user who then sees
    // the "signed in as X, not on the staff list" panel rather than being told
    // their domain was refused.
    const requiredDomain = config.auth?.staff?.googleWorkspaceDomain?.toLowerCase();
    if (requiredDomain) {
      const email = data?.user?.email?.toLowerCase() ?? "";
      const domain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";
      if (domain !== requiredDomain) {
        await supabase.auth.signOut();
        return loginRedirect("wrong_domain");
      }
    }

    const staffHome = config.auth?.staff?.staffHome ?? "/admin";
    return NextResponse.redirect(new URL(staffHome, requestUrl.origin));
  };
}
