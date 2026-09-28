export type AdminNavItem = {
  href: string;
  label: string;
  exact?: boolean;
  requires: readonly string[];
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", exact: true, requires: ["admin"] },
  { href: "/admin/reports", label: "Reports", requires: ["admin"] },
  { href: "/admin/audit", label: "Audit log", requires: ["admin"] },
  { href: "/admin/events", label: "Event requests", requires: ["admin"] },
  { href: "/admin/wholesale", label: "Wholesale", requires: ["admin"] },
  { href: "/admin/orders", label: "Orders", requires: ["admin", "ordering"] },
  { href: "/admin/customers", label: "Customers", requires: ["admin"] },
  { href: "/admin/inventory", label: "Inventory", requires: ["admin", "inventory"] },
  { href: "/admin/catalog", label: "Catalog & pricing", requires: ["admin", "catalog"] },
  { href: "/admin/locations", label: "Locations", requires: ["admin"] },
  { href: "/admin/content", label: "Homepage", requires: ["cms"] },
  { href: "/admin/staff", label: "Staff", requires: ["admin"] },
];

/**
 * Staff surfaces that live at the top level rather than under /admin.
 *
 * module-crm mounts at /crm and module-expense at /expenses -- their declared
 * routes, not /admin/crm. A client that enables those and NOT module-admin
 * (apps/electrotek) got an empty nav from ADMIN_NAV_ITEMS, because every entry
 * there requires "admin". Signed-in staff landed on /crm with no way to reach
 * anything else.
 */
export const STAFF_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/cases", label: "Case files", requires: ["forensic-case"] },
  { href: "/crm", label: "CRM", requires: ["crm"] },
  { href: "/expenses", label: "Expenses", requires: ["expense"] },
];

/** Every staff destination for a config: /admin surfaces plus top-level ones. */
export function resolveStaffNav(enabledModuleIds: readonly string[]): AdminNavItem[] {
  const enabled = new Set(enabledModuleIds);
  return [...ADMIN_NAV_ITEMS, ...STAFF_NAV_ITEMS].filter((item) => {
    if (!item.requires.every((moduleId) => enabled.has(moduleId))) return false;
    // module-forensic-case supersedes the CRM workspace: a case file is where
    // these staff work, and a case file already carries the same customer/
    // contact records CRM shows. Two nav entries pointing at the same records
    // read as two systems, so drop /crm once forensic-case is enabled.
    if (item.href === "/crm" && enabled.has("forensic-case")) return false;
    return true;
  });
}

export function resolveAdminNav(enabledModuleIds: readonly string[]): AdminNavItem[] {
  const enabled = new Set(enabledModuleIds);
  return ADMIN_NAV_ITEMS.filter((item) =>
    item.requires.every((moduleId) => enabled.has(moduleId)),
  );
}
