import "server-only";

/**
 * Demo-only authorize gate for the mounted ERP module API routes.
 *
 * The module route factories are deny-by-default: with no `authorize` they 401
 * every request, because they are backed by the RLS-bypassing service-role
 * client and are designed to sit behind a real staff auth session.
 *
 * apps/_template has no staff session wired yet, so for the all-modules demo we
 * open these routes ONLY when BANANAFORCE_DEMO_OPEN_API=1 is set (.env.local).
 * Unset — i.e. any real deploy that forgets the flag — keeps the routes locked.
 *
 * NEVER set this flag on a deployment that holds real client data: it exposes
 * staff-only read AND write endpoints (service-role backed) with no auth.
 */
if (
  process.env.BANANAFORCE_DEMO_OPEN_API === "1" &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
) {
  console.error(
    "[BANANAFORCE SECURITY WARNING] BANANAFORCE_DEMO_OPEN_API=1 is set while SUPABASE_SERVICE_ROLE_KEY is configured. Staff service-role APIs are open to unauthenticated requests.",
  );
}

/**
 * Local development also opens these routes, and the staff pages in front of
 * them, without a Google session.
 *
 * Staff sign-in cannot complete against a dev server. `login-form.tsx` builds
 * the OAuth callback from `window.location.origin`, so signing in from
 * localhost asks Supabase to return to `http://localhost:<port>/auth/callback`;
 * that origin is not in the project's redirect allow-list, so Supabase falls
 * back to its configured Site URL and delivers the session to production
 * instead. The result is that `next dev` can never render /cases, /crm or
 * /expenses at all — every request 307s to /admin/login forever, and the
 * developer ends up reviewing the deployed build while believing they are
 * looking at their own working tree.
 *
 * `NODE_ENV` is "development" only under `next dev`. `next build` and every
 * deployment — Vercel preview and production alike — compile as "production",
 * where this returns false and the Google gate is the only way in. The flag
 * above stays the sole opt-in for a deployed demo.
 */
const isLocalDevelopment = (): boolean => process.env.NODE_ENV === "development";

export const demoAuthorize = (): boolean =>
  process.env.BANANAFORCE_DEMO_OPEN_API === "1" || isLocalDevelopment();
