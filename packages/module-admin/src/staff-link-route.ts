import "server-only";

import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { finishStaffSignIn, loginRedirect } from "./staff-sign-in";

/**
 * Lands a one-time staff sign-in link at /auth/confirm (WAL-930).
 *
 * `pnpm staff-login <app>` mints the link on the operator's machine with the
 * project's service role (auth.admin.generateLink, which sends no email) and
 * opens https://<domain>/auth/confirm?token_hash=...&type=magiclink. Verifying
 * the hash here, server-side, writes the session cookies on the app's own
 * origin -- the same result as finishing Google SSO, without the Google hop.
 *
 * Only `magiclink` is accepted: recovery, invite and email-change hashes carry
 * other meanings and have no business signing staff in through this route.
 *
 * Like the OAuth callback, a session is not access. getStaffUser() still
 * requires a public.staff row, and finishStaffSignIn applies the client's
 * googleWorkspaceDomain rule. The redirect target comes from config, never the
 * query string.
 */
export function createStaffLinkRoute(config: ClientConfig) {
  return async function GET(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const tokenHash = requestUrl.searchParams.get("token_hash");
    if (!tokenHash || requestUrl.searchParams.get("type") !== "magiclink") {
      return loginRedirect(requestUrl.origin, "invalid_sign_in_link");
    }
    if (!isSupabaseConfigured()) return loginRedirect(requestUrl.origin, "supabase_not_configured");

    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (error) return loginRedirect(requestUrl.origin, "sign_in_link_expired");

    return finishStaffSignIn(config, requestUrl.origin, data?.user?.email, () => supabase.auth.signOut({ scope: "local" }));
  };
}
