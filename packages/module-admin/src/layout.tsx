import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { getStaffUser } from "./auth";
import { resolveAdminNav } from "./nav";
import { AdminShell } from "./shell";

export function createAdminLayout(clientConfig: ClientConfig) {
  const navItems = resolveAdminNav(clientConfig.modules);

  return async function AdminLayout({ children }: { children: React.ReactNode }) {
    const staff = await getStaffUser();
    if (!staff) {
      return <div className="admin-bare">{children}</div>;
    }
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
