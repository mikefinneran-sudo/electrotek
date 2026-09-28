/**
 * Human-readable text for the ?error= reasons createOAuthCallbackRoute forwards
 * to /admin/login.
 *
 * Split out of admin-pages.tsx so it is testable without dragging the server-only
 * Supabase imports into a unit test. The original bug this whole path exists to
 * fix was a mechanism that compiled and did nothing; keeping this untestable
 * would have preserved exactly that risk.
 */
export const OAUTH_ERROR_TEXT: Record<string, string> = {
  wrong_domain:
    "That Google account is not on this organisation's domain. Sign in with your work account.",
  missing_oauth_code: "Google did not return a sign-in code. Please try again.",
  supabase_not_configured:
    "Sign-in is not configured for this site yet. Contact your administrator.",
  oauth_exchange_failed:
    "Could not complete Google sign-in. The link may have expired — please try again.",
  access_denied: "Google sign-in was cancelled.",
};

/**
 * Google's own error codes, forwarded verbatim by the callback route.
 *
 * org_internal is the one that matters operationally: with an Internal consent
 * screen, that is exactly what a Google account outside the client's Workspace
 * receives. Without a mapping it read as a generic failure and looked like a
 * broken integration rather than the access control working as designed.
 */
const GOOGLE_ERROR_TEXT: Record<string, string> = {
  access_denied: "Google sign-in was cancelled.",
  org_internal:
    "That Google account is outside this organisation. Sign in with your work account.",
  admin_policy_enforced:
    "A Google Workspace policy blocked this sign-in. Contact your administrator.",
  disallowed_useragent: "This browser cannot complete Google sign-in. Try a different browser.",
  redirect_uri_mismatch:
    "Sign-in is misconfigured for this site. Contact your administrator.",
  invalid_client: "Sign-in is misconfigured for this site. Contact your administrator.",
};

export function oauthErrorMessage(reason: string): string {
  const known = OAUTH_ERROR_TEXT[reason] ?? GOOGLE_ERROR_TEXT[reason];
  if (known) return known;

  // Deliberately NO raw echo of the reason.
  //
  // An earlier version echoed any value matching /^[a-zA-Z0-9_-]{1,64}$/ for
  // debuggability. That charset still spells a legible phone number
  // (?error=call-1-800-555-0100) or a hyphen-joined sentence
  // (?error=account-suspended-contact-admin-now), which then rendered as though
  // this site had said it -- reflected-text phishing on a real login page.
  // Escaping stops markup, not social engineering, and no charset that permits
  // word separators can stop it. Debuggability is unaffected: the raw reason is
  // still in the URL and in server logs.
  return "Google sign-in failed. Please try again.";
}
