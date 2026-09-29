import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "./server";
import { getSupabaseServiceClient } from "./service";

/**
 * Staff data client for the RLS rollout.
 *
 * Real staff sessions use the cookie-scoped Supabase client so RLS sees
 * auth.uid(). The all-modules demo can still use the service-role client when
 * explicitly opened by BANANAFORCE_DEMO_OPEN_API=1.
 */
export async function getStaffDbClient(): Promise<SupabaseClient | null> {
  const session = await getSupabaseServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  // Being logged in is not enough — customers are authenticated too. Confirm the
  // session actually satisfies is_staff() (the same predicate the RLS policies
  // use) before handing back a staff client; otherwise a customer would pass a
  // caller's `if (!db) return 401` guard and get 200-empty instead of 403.
  if (user) {
    const { data: isStaff } = await session.rpc("is_staff");
    return isStaff === true ? session : null;
  }
  // Demo only: the all-modules demo has no staff session and deliberately runs
  // open under BANANAFORCE_DEMO_OPEN_API=1 (documented tradeoff — the live demo
  // is a prod deploy that depends on it; app boot logs a loud warning when the
  // flag is set alongside a real service-role key). Never set it on a deploy
  // holding real client data.
  if (process.env.BANANAFORCE_DEMO_OPEN_API === "1") {
    return getSupabaseServiceClient();
  }
  return null;
}
