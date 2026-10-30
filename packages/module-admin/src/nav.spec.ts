import { describe, it, expect } from "vitest";
import { resolveAdminNav, resolveStaffNav } from "./nav";

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
