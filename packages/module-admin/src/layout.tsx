import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { getStaffUser } from "./auth";
import { applyNavLayout, resolveAdminNav } from "./nav";
import { getNavLayout } from "./nav-layout";
import { AdminShell } from "./shell";

export function createAdminLayout(clientConfig: ClientConfig) {
  const baseNav = resolveAdminNav(clientConfig.modules);

  return async function AdminLayout({ children }: { children: React.ReactNode }) {
    const staff = await getStaffUser();
    if (!staff) {
      return <div className="admin-bare">{children}</div>;
    }
    return (
      <AdminShell
        brandName={clientConfig.brand.name}
        navItems={applyNavLayout(baseNav, await getNavLayout())}
        staffEmail={staff.email}
        staffName={staff.name}
        staffRole={staff.role}
        canCustomize={staff.role === "admin"}
      >
        {children}
      </AdminShell>
    );
  };
}
