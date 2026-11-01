export type AdminNavItem = {
  href: string;
  label: string;
  exact?: boolean;
  requires: readonly string[];
  /** Built-in label, kept when a client renames the item (placeholder + reset). */
  defaultLabel?: string;
};

/** site_content key holding the client's sidebar order and renamed labels. */
export const NAV_LAYOUT_KEY = "staff.nav";
export const NAV_LABEL_MAX = 40;

/** Client-chosen sidebar order (hrefs) and labels (href -> label). One per client. */
export type NavLayout = { order: string[]; labels: Record<string, string> };

/** Coerce stored JSON into a NavLayout. Anything malformed becomes null, i.e. defaults. */
export function parseNavLayout(value: unknown): NavLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { order?: unknown; labels?: unknown };
  const order = Array.isArray(v.order)
    ? v.order.filter((href): href is string => typeof href === "string" && href.startsWith("/"))
    : [];
  const labels = new Map<string, string>();
  if (v.labels && typeof v.labels === "object" && !Array.isArray(v.labels)) {
    for (const [href, label] of Object.entries(v.labels)) {
      const clean = typeof label === "string" ? label.trim().slice(0, NAV_LABEL_MAX) : "";
      if (href.startsWith("/") && clean) labels.set(href, clean);
    }
  }
  return { order: [...new Set(order)], labels: Object.fromEntries(labels) };
}

/**
 * Apply a client's layout to the module-gated nav. Items named in layout.order
 * come first, in that order; the rest keep their default order after them, so a
 * newly enabled module still appears. The layout never adds an item: a saved
 * href whose module is now off simply does not render.
 */
export function applyNavLayout(
  items: readonly AdminNavItem[],
  layout: NavLayout | null,
): AdminNavItem[] {
  const rank = new Map((layout?.order ?? []).map((href, i) => [href, i]));
  const at = (href: string) => rank.get(href) ?? Number.MAX_SAFE_INTEGER;
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => at(a.item.href) - at(b.item.href) || a.i - b.i)
    .map(({ item }) => ({
      ...item,
      label: layout?.labels[item.href] ?? item.label,
      defaultLabel: item.label,
    }));
}

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
  { href: "/licenses", label: "Licenses", requires: ["licensing"] },
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

/**
 * Combine a save from one sidebar with the stored layout. The editor only
 * holds the items it showed (/admin and the top-level staff pages show
 * different lists; disabled modules are absent), so stored entries for every
 * other href are kept. An empty save is a reset and clears everything.
 * Unknown hrefs and labels equal to the default are dropped.
 */
export function mergeNavLayout(
  stored: NavLayout | null,
  incoming: NavLayout,
  defaults: ReadonlyMap<string, string>,
): NavLayout {
  if (incoming.order.length === 0 && Object.keys(incoming.labels).length === 0) {
    return { order: [], labels: {} };
  }
  const edited = new Set(incoming.order);
  const kept = (href: string) => !edited.has(href) && defaults.has(href);
  const order = [...incoming.order.filter((href) => defaults.has(href)), ...(stored?.order ?? []).filter(kept)];
  const labels = Object.fromEntries(
    [
      ...Object.entries(stored?.labels ?? {}).filter(([href]) => kept(href)),
      ...Object.entries(incoming.labels).filter(([href]) => edited.has(href) && defaults.has(href)),
    ].filter(([href, label]) => label !== defaults.get(href)),
  );
  return { order, labels };
}
