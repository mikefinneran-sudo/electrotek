import type { ClientConfig } from "./types";

export interface StaffLoginLink {
  href: string;
  label: string;
}

/**
 * Staff login link for the app header. Gated on whether staff auth is
 * configured — nothing else. Must NOT depend on which modules are enabled:
 * a client can have staff auth configured with the `admin` module disabled,
 * and the login link still needs to exist so staff can sign in.
 *
 * (WAL-500: apps/_template previously gated this on `enabled.has("admin")`,
 * which shipped an invisible login link on day one for any client scaffolded
 * from the template with staff auth but without the retail admin module.)
 */
export function staffLoginLink(config: ClientConfig): StaffLoginLink | null {
  if (!config.auth?.staff) return null;
  return { href: "/admin/login", label: "Staff Login" };
}

/**
 * Demo header nav — keep short (Stripe / Linear idiom). Full module
 * directory lives on the homepage.
 *
 * (WAL-591: apps/_template/lib/demo-nav.ts and apps/waltersignal/lib/demo-nav.ts
 * were byte-identical copies encoding module ids and their routes. When a
 * module route changes or a module is added, the template and a shipped
 * client app can silently disagree — nothing in typecheck, test,
 * check-mounts, or lint catches it, because both files are individually
 * valid. Same failure class as the staffLoginLink duplication above.)
 */
export type DemoNavLink = {
  id: string;
  href: string;
  label: string;
};

// `readonly` is load-bearing now that these are shared. While each app held
// its own copy, mutating one affected only that app; a single shared default
// mutated by any consumer would affect every app at once.
export const DEMO_OPS_NAV: readonly DemoNavLink[] = [
  { id: "inventory", href: "/inventory", label: "Inventory" },
  { id: "crm", href: "/crm", label: "CRM" },
  { id: "ordering", href: "/sales", label: "Sales" },
];

export const DEMO_STORE_NAV: readonly DemoNavLink[] = [
  { id: "catalog", href: "/catalog", label: "Shop" },
  { id: "ordering", href: "/orders", label: "Orders" },
];

export interface DemoNavLinkTables {
  ops: readonly DemoNavLink[];
  store: readonly DemoNavLink[];
}

/**
 * Filters the ops/store demo nav link tables down to enabled modules.
 * Defaults to the shared tables above; a client app that genuinely needs a
 * different label set, ordering, or subset can pass its own `tables`
 * override instead of hand-editing a forked copy of this file.
 */
export function demoNavLinks(enabled: Set<string>, tables: DemoNavLinkTables = { ops: DEMO_OPS_NAV, store: DEMO_STORE_NAV }) {
  const ops = tables.ops.filter((link) => enabled.has(link.id));
  const store = tables.store.filter((link) => enabled.has(link.id));
  return { ops, store };
}
