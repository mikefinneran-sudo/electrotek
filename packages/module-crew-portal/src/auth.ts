// Real staff auth for the crew portal. This is where the staff-session boundary
// finally LANDS: earlier modules (quote-engine, contract-esign, visit-checkflow,
// admin) shipped a deny-by-default `authorize` hook with the session check left
// to the consuming app. crew-portal provides the concrete check the whole deploy
// stack can wire in.
//
// isStaffRequest() verifies a STAFF Supabase session, not the RLS-bypassing
// service-role key:
//   1. Read the cookie-scoped session via getSupabaseServerClient() (anon key,
//      RLS applies). No service-role key is touched here.
//   2. Require an authenticated user (auth.getUser()).
//   3. Confirm staff membership via the public.is_staff() security-definer RPC
//      that the admin module created (0001_admin.sql). is_staff() runs as its
//      owner and checks `auth.uid() in public.staff`, so a signed-in customer
//      (also `authenticated`) returns false.
//
// Returns a plain boolean and NEVER throws: any error (no session, RPC missing,
// env unset) resolves to false, so the deny-by-default posture holds end to end.

import "server-only";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";

/**
 * True iff the current request carries a Supabase session whose user is a member
 * of public.staff. Fail-closed: returns false on any error or missing session.
 *
 * Wire this into the route factory and page factory as `authorize`:
 *   createCrewRouteHandlers({ authorize: () => isStaffRequest() })
 *   createCrewPage(config, { authorize: () => isStaffRequest() })
 */
export async function isStaffRequest(): Promise<boolean> {
  try {
    const supabase = await getSupabaseServerClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return false;

    // is_staff() is the security-definer predicate admin owns; it reads
    // public.staff as its owner so the caller needs no select grant. The RPC is
    // evaluated under the caller's auth.uid() (the cookie session), so it only
    // returns true for an actual staff user.
    const { data, error } = await supabase.rpc("is_staff");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
