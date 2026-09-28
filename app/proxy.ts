import { applySecurityHeaders } from "@waltersignal/bananaforce-core/security-headers";
import { updateSession } from "@waltersignal/bananaforce-data-supabase/session";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Must precede updateSession: it calls NextResponse.next({ request }), which
  // snapshots the request headers. Anything set afterwards never reaches the
  // server components, so the staff chrome saw no x-pathname and rendered
  // nothing.
  request.headers.set("x-pathname", request.nextUrl.pathname);

  const response = await updateSession(request);
  // CSP is set here, not in vercel.json: Next's inline RSC scripts need a
  // per-request nonce, and a second static CSP header would intersect with
  // this one and block them again.
  return applySecurityHeaders(request, response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
