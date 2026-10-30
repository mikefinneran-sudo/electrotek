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
  { href: "/intake", label: "Walkthroughs", requires: ["quote-engine"] },
  { href: "/schedule", label: "Schedule", requires: ["scheduling"] },
  { href: "/contract", label: "Contracts", requires: ["contract-esign"] },
  { href: "/visit", label: "Visits", requires: ["visit-checkflow"] },
  { href: "/crew", label: "Crew", requires: ["crew-portal"] },
  { href: "/messages", label: "Messages", requires: ["communications"] },
  { href: "/reports", label: "Reports", requires: ["reporting"] },
  { href: "/billing", label: "Invoices", requires: ["billing"] },
  { href: "/expenses", label: "Expenses", requires: ["expense"] },
];

/** Every staff destination for a config: /admin surfaces plus top-level ones. */
export function resolveStaffNav(enabledModuleIds: readonly string[]): AdminNavItem[] {
  const enabled = new Set(enabledModuleIds);
  return [...ADMIN_NAV_ITEMS, ...STAFF_NAV_ITEMS].filter((item) => {
    return item.requires.every((moduleId) => enabled.has(moduleId));
  });
}

export function resolveAdminNav(enabledModuleIds: readonly string[]): AdminNavItem[] {
  const enabled = new Set(enabledModuleIds);
  return ADMIN_NAV_ITEMS.filter((item) =>
    item.requires.every((moduleId) => enabled.has(moduleId)),
  );
}
