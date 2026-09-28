import { describe, expect, it } from "vitest";
import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { ALL_CRM_SURFACES, CASE_FILE_SURFACES } from "./ui";

/**
 * The surface derivation, asserted on the rule rather than through React.
 * `createCrmPage` reads `clientConfig.modules`, so the decision is testable
 * without rendering: a client running forensic-case is not a sales org.
 */
function surfacesFor(config: ClientConfig) {
  return config.modules.includes("forensic-case") ? CASE_FILE_SURFACES : ALL_CRM_SURFACES;
}

const base: ClientConfig = {
  slug: "test",
  domain: "example.com",
  brand: { name: "Test", colors: { primary: "#000", primaryDark: "#000" } },
  data: { adapter: "supabase", projectRef: "abc" },
  modules: ["crm"],
};

describe("crm surfaces", () => {
  it("gives a sales org every surface", () => {
    expect(surfacesFor(base)).toEqual(["pipeline", "cases", "accounts", "contacts", "tasks"]);
  });

  it("gives a forensic practice case files and the parties on them", () => {
    const surfaces = surfacesFor({ ...base, modules: ["crm", "forensic-case"] });
    expect(surfaces).toEqual(["cases", "accounts", "contacts"]);
  });

  it("keeps every sales surface out of a case-file workspace", () => {
    const surfaces = surfacesFor({ ...base, modules: ["crm", "forensic-case"] });
    for (const sales of ["pipeline", "opportunities", "tasks"]) {
      expect(surfaces).not.toContain(sales);
    }
  });

  it("opens on cases, not on whatever happens to be first in the type", () => {
    expect(surfacesFor({ ...base, modules: ["crm", "forensic-case"] })[0]).toBe("cases");
  });
});
