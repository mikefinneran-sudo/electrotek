import { describe, it, expect } from "vitest";
import {
  ADMIN_NAV_ITEMS,
  STAFF_NAV_ITEMS,
  applyNavLayout,
  mergeNavLayout,
  parseNavLayout,
  resolveAdminNav,
  resolveStaffNav,
} from "./nav";

describe("resolveStaffNav", () => {
  // apps/electrotek: crm + expense, no module-admin. This produced an EMPTY nav,
  // so signed-in staff landed on /crm with no way to reach anything else.
  it("gives a staff-only client its top-level surfaces", () => {
    const nav = resolveStaffNav(["crm", "expense"]);
    expect(nav.map((i) => i.href)).toEqual(["/crm", "/expenses"]);
  });

  it("is not empty for any client that enables a staff module", () => {
    for (const modules of [["crm"], ["expense"], ["crm", "expense"], ["admin", "crm"]]) {
      expect(resolveStaffNav(modules).length, modules.join("+")).toBeGreaterThan(0);
    }
  });

  it("still resolves the /admin surfaces for a full admin client", () => {
    const nav = resolveStaffNav(["admin", "catalog", "ordering", "inventory", "crm"]);
    expect(nav.some((i) => i.href === "/admin")).toBe(true);
    expect(nav.some((i) => i.href === "/admin/orders")).toBe(true);
    expect(nav.some((i) => i.href === "/crm")).toBe(true);
  });

  it("omits surfaces whose modules are off", () => {
    const hrefs = resolveStaffNav(["crm"]).map((i) => i.href);
    expect(hrefs).not.toContain("/expenses");
    expect(hrefs).not.toContain("/admin");
  });

  // apps/abc: a service-business client with no module-admin. Before these
  // entries its sidebar held only CRM, so quoting and scheduling had no link.
  it("gives a field-service client every staff surface it enabled", () => {
    const nav = resolveStaffNav([
      "lead-capture", "crm", "quote-engine", "scheduling", "contract-esign",
      "crew-portal", "visit-checkflow", "client-portal", "communications", "reporting",
    ]);
    expect(nav.map((i) => i.href)).toEqual([
      "/crm", "/intake", "/schedule", "/contract", "/visit", "/crew", "/messages", "/reports",
    ]);
  });

  // Regression guard: resolveAdminNav is what produced the empty nav.
  it("resolveAdminNav is still /admin-only", () => {
    expect(resolveAdminNav(["crm", "expense"])).toEqual([]);
  });
});

describe("licensing staff nav", () => {
  it("shows /licenses only when licensing is enabled", () => {
    expect(resolveStaffNav(["crm", "licensing"]).map((item) => item.href)).toContain("/licenses");
    expect(resolveStaffNav(["crm", "expense"]).map((item) => item.href)).not.toContain("/licenses");
  });
});

describe("case-file staff nav", () => {
  it("gives a forensic client a case files destination", () => {
    const nav = resolveStaffNav(["crm", "expense", "forensic-case"]);
    expect(nav.map((item) => item.href)).toContain("/cases");
  });

  it("puts case files first, because that is where these staff work", () => {
    const nav = resolveStaffNav(["crm", "expense", "forensic-case"]);
    expect(nav[0]?.href).toBe("/cases");
  });

  it("does not show case files to a client without the module", () => {
    const nav = resolveStaffNav(["crm", "expense"]);
    expect(nav.map((item) => item.href)).not.toContain("/cases");
  });

  it("keeps /crm for a forensic-case client -- enabling a module never hides another", () => {
    const nav = resolveStaffNav(["crm", "expense", "forensic-case"]);
    expect(nav.map((item) => item.href)).toContain("/crm");
  });

  it("still shows /crm to a non-forensic client", () => {
    const nav = resolveStaffNav(["crm", "expense"]);
    expect(nav.map((item) => item.href)).toContain("/crm");
  });

  it("keeps /cases first for a forensic client, with /crm still present", () => {
    const nav = resolveStaffNav(["crm", "expense", "forensic-case"]);
    expect(nav.map((item) => item.href)).toEqual(["/cases", "/crm", "/expenses"]);
  });
});

describe("billing staff nav", () => {
  it("shows Invoices when billing is enabled", () => {
    expect(resolveStaffNav(["billing"])).toContainEqual({
      href: "/billing",
      label: "Invoices",
      requires: ["billing"],
    });
  });

  it("does not show Invoices when billing is absent", () => {
    expect(resolveStaffNav(["crm", "expense"]).map((item) => item.label)).not.toContain(
      "Invoices",
    );
  });

  it("adding billing never removes another config's destinations", () => {
    const modules = ["crm", "quote-engine", "scheduling", "expense"];
    const before = resolveStaffNav(modules).map((item) => item.href);
    const after = resolveStaffNav([...modules, "billing"]).map((item) => item.href);

    expect(after).toEqual(expect.arrayContaining(before));
  });
});

describe("applyNavLayout (WAL-1078)", () => {
  const base = resolveStaffNav(["admin", "crm", "expense", "billing"]);
  const hrefs = (items: { href: string }[]) => items.map((i) => i.href);

  it("hrefs are unique across both lists, so one layout can key on them", () => {
    const all = hrefs([...ADMIN_NAV_ITEMS, ...STAFF_NAV_ITEMS]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("no layout keeps the default order and labels", () => {
    const nav = applyNavLayout(base, null);
    expect(hrefs(nav)).toEqual(hrefs(base));
    expect(nav.every((i) => i.defaultLabel === i.label)).toBe(true);
  });

  it("puts saved hrefs first in saved order, the rest after in default order", () => {
    const nav = applyNavLayout(base, { order: ["/expenses", "/crm"], labels: {} });
    const rest = hrefs(base).filter((h) => h !== "/expenses" && h !== "/crm");
    expect(hrefs(nav)).toEqual(["/expenses", "/crm", ...rest]);
  });

  it("renames by href and keeps the built-in label as defaultLabel", () => {
    const crm = applyNavLayout(base, { order: [], labels: { "/crm": "Pipeline" } }).find(
      (i) => i.href === "/crm",
    );
    expect(crm).toMatchObject({ label: "Pipeline", defaultLabel: "CRM" });
  });

  it("never shows an item whose module is off, even if the layout names it", () => {
    const nav = applyNavLayout(resolveStaffNav(["crm"]), {
      order: ["/expenses", "/crm"],
      labels: { "/expenses": "Spend" },
    });
    expect(hrefs(nav)).toEqual(["/crm"]);
  });
});

describe("parseNavLayout", () => {
  it("returns null for anything that is not an object", () => {
    for (const v of [null, undefined, "x", 3, [], true]) expect(parseNavLayout(v)).toBeNull();
  });

  it("drops bad entries instead of failing", () => {
    expect(
      parseNavLayout({
        order: ["/crm", 5, "crm", "/crm", null],
        labels: { "/crm": "  Pipeline  ", "/x": "", "/y": 7, nope: "z", "/long": "a".repeat(60) },
      }),
    ).toEqual({ order: ["/crm"], labels: { "/crm": "Pipeline", "/long": "a".repeat(40) } });
  });

  it("tolerates missing fields", () => {
    expect(parseNavLayout({})).toEqual({ order: [], labels: {} });
  });
});

describe("mergeNavLayout", () => {
  const defaults = new Map([
    ["/admin", "Dashboard"],
    ["/admin/orders", "Orders"],
    ["/crm", "CRM"],
    ["/schedule", "Schedule"],
  ]);
  const stored = { order: ["/schedule", "/crm", "/admin/orders"], labels: { "/crm": "Clients", "/admin/orders": "Sales" } };

  it("keeps stored entries the editor did not show (other sidebar, disabled modules)", () => {
    const out = mergeNavLayout(stored, { order: ["/admin/orders", "/admin"], labels: { "/admin": "Home" } }, defaults);
    expect(out.order).toEqual(["/admin/orders", "/admin", "/schedule", "/crm"]);
    // Orders was in the editor with no label, so its rename is cleared; CRM's survives.
    expect(out.labels).toEqual({ "/admin": "Home", "/crm": "Clients" });
  });

  it("drops unknown hrefs and labels equal to the default", () => {
    const out = mergeNavLayout(null, { order: ["/nope", "/crm"], labels: { "/crm": "CRM", "/nope": "X" } }, defaults);
    expect(out).toEqual({ order: ["/crm"], labels: {} });
  });

  it("an empty save resets everything", () => {
    expect(mergeNavLayout(stored, { order: [], labels: {} }, defaults)).toEqual({ order: [], labels: {} });
  });
});
