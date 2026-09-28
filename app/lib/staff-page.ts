import "server-only";
import { redirect } from "next/navigation";
import { isStaffRequest } from "@waltersignal/bananaforce-module-crew-portal/auth";
import { demoAuthorize } from "./authorize";

/**
 * Page-level staff gate for operator (staff-audience) routes.
 *
 * The module page factories render service-role (RLS-bypassing) data directly,
 * so the PAGE must gate before rendering — the route-layer authorize only
 * protects the API. Allows a real staff session (isStaffRequest) OR the
 * demo-open flag (demoAuthorize); otherwise redirects to the staff login.
 *
 * This is the same allow set the mounted API routes use, applied at the page
 * boundary so unauthenticated visitors get a login redirect instead of a UI
 * full of 401 errors.
 */
export async function ensureStaffOrDemo(): Promise<void> {
  if (demoAuthorize()) return;
  if (await isStaffRequest()) return;
  redirect("/admin/login");
}
