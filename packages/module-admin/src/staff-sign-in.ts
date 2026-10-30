import "server-only";

import { NextResponse } from "next/server";
import type { ClientConfig } from "@waltersignal/bananaforce-core";

/** Where a failed staff sign-in lands, with the reason in ?error=. */
export function loginRedirect(origin: string, reason: string): Response {
  const redirectUrl = new URL("/admin/login", origin);
  redirectUrl.searchParams.set("error", reason);
  return NextResponse.redirect(redirectUrl);
}

/**
 * Last hop shared by every staff sign-in route, once Supabase has set a session.
 *
 * Domain enforcement for External consent screens.
 *
 * An Internal consent screen restricts sign-in to its own Workspace org, so
 * clients configured that way set no googleWorkspaceDomain and skip this.
 * With External, `hd` on the authorize URL is only a hint to the account
 * chooser -- anyone can strip it -- so the real check has to happen here,
 * after the session exists, against the email Supabase actually returned.
 *
 * Signing out on rejection matters: the session is already established.
 * Leaving it would strand a signed-in non-staff user who then sees the
 * "signed in as X, not on the staff list" panel rather than being told their
 * domain was refused. Callers sign out with scope "local" so a refusal here
 * ends this browser's session only, not the account's sessions elsewhere.
 */
export async function finishStaffSignIn(
  config: ClientConfig,
  origin: string,
  email: string | undefined,
  signOut: () => Promise<unknown>,
): Promise<Response> {
  const requiredDomain = config.auth?.staff?.googleWorkspaceDomain?.toLowerCase();
  if (requiredDomain) {
    const address = email?.toLowerCase() ?? "";
    const domain = address.includes("@") ? address.slice(address.lastIndexOf("@") + 1) : "";
    if (domain !== requiredDomain) {
      await signOut();
      return loginRedirect(origin, "wrong_domain");
    }
  }

  const staffHome = config.auth?.staff?.staffHome ?? "/admin";
  return NextResponse.redirect(new URL(staffHome, origin));
}
