import "server-only";

import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { getStaffUser } from "./auth";
import { resolveStaffNav } from "./nav";
import { AdminShell } from "./shell";

/**
 * Back-office shell for staff surfaces that live OUTSIDE /admin.
 *
 * module-crm mounts at /crm and module-expense at /expenses -- their own
 * declared routes. The shell lived only at app/admin/layout.tsx, so a staff-only
 * client (apps/electrotek, staffHome "/crm") signed in and got a page with no
 * navigation at all.
 *
 * Used as a Next layout for those route segments, so wrapping is decided by the
 * route tree rather than by inspecting the request path. An earlier version read
 * an x-pathname header set in middleware; that header never arrived, because
 * updateSession calls NextResponse.next({ request }) and snapshots the headers
 * before it was set. The shell then silently rendered nothing -- exactly the
 * class of failure this codebase keeps producing. A layout cannot miss.
 */
export function createStaffLayout(clientConfig: ClientConfig) {
  const navItems = resolveStaffNav(clientConfig.modules);

  return async function StaffLayout({ children }: { children: React.ReactNode }) {
    const staff = await getStaffUser();
    // Unauthenticated visitors are redirected by the page's own guard; render
    // bare rather than showing a nav they cannot use.
    if (!staff) return <>{children}</>;

    return (
      <AdminShell
        brandName={clientConfig.brand.name}
        navItems={navItems}
        staffEmail={staff.email}
        staffName={staff.name}
        staffRole={staff.role}
      >
        {children}
      </AdminShell>
    );
  };
}
