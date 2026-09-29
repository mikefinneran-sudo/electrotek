import { describe, expect, it } from "vitest";
import { DEMO_OPS_NAV, DEMO_STORE_NAV, demoNavLinks, staffLoginLink } from "./nav";
import type { ClientConfig } from "./types";

function baseConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    slug: "acme",
    domain: "acme.example.com",
    brand: { name: "Acme" },
    data: { adapter: "supabase" },
    modules: [],
    ...overrides,
  };
}

describe("staffLoginLink", () => {
  it("shows the login link when staff auth is configured and the admin module is enabled", () => {
    const config = baseConfig({
      auth: { staff: { provider: "supabase" } },
      modules: ["admin"],
    });

    expect(staffLoginLink(config)).toEqual({
      href: "/admin/login",
      label: "Staff Login",
    });
  });

  it("shows the login link when staff auth is configured but the admin module is NOT enabled (WAL-500 regression)", () => {
    const config = baseConfig({
      auth: { staff: { provider: "supabase" } },
      modules: [],
    });

    expect(staffLoginLink(config)).toEqual({
      href: "/admin/login",
      label: "Staff Login",
    });
  });

  it("hides the login link when no staff auth is configured", () => {
    const config = baseConfig({ modules: ["admin"] });

    expect(staffLoginLink(config)).toBeNull();
  });
});

describe("demoNavLinks", () => {
  it("filters ops and store links to the enabled module set", () => {
    const enabled = new Set(["inventory", "catalog"]);

    expect(demoNavLinks(enabled)).toEqual({
      ops: [{ id: "inventory", href: "/inventory", label: "Inventory" }],
      store: [{ id: "catalog", href: "/catalog", label: "Shop" }],
    });
  });

  it("excludes a module that is not enabled", () => {
    const enabled = new Set(["inventory"]);

    const { ops, store } = demoNavLinks(enabled);

    expect(ops.some((link) => link.id === "crm")).toBe(false);
    expect(store).toEqual([]);
  });

  it("splits links between the ops and store tables", () => {
    const enabled = new Set(["inventory", "crm", "ordering", "catalog"]);

    const { ops, store } = demoNavLinks(enabled);

    expect(ops.map((link) => link.id)).toEqual(["inventory", "crm", "ordering"]);
    expect(store.map((link) => link.id)).toEqual(["catalog", "ordering"]);
  });

  it("uses the shared default tables when no override is passed", () => {
    const enabled = new Set(DEMO_OPS_NAV.concat(DEMO_STORE_NAV).map((link) => link.id));

    const { ops, store } = demoNavLinks(enabled);

    expect(ops).toEqual(DEMO_OPS_NAV);
    expect(store).toEqual(DEMO_STORE_NAV);
  });

  it("uses a custom link table override instead of the shared defaults", () => {
    const customOps = [{ id: "widgets", href: "/widgets", label: "Widgets" }];
    const customStore = [{ id: "shop", href: "/shop", label: "Shop" }];
    const enabled = new Set(["widgets", "shop"]);

    const { ops, store } = demoNavLinks(enabled, { ops: customOps, store: customStore });

    expect(ops).toEqual(customOps);
    expect(store).toEqual(customStore);
  });
});
