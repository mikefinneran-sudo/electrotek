import { describe, expect, it } from "vitest";
import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { createCrmPage } from "./page";
import { ALL_CRM_SURFACES, CASE_FILE_SURFACES } from "./ui";

/**
 * Surfaces are asserted on the rendered element's props, not through the DOM:
 * the factory's only decision is which surfaces it hands CrmView.
 */
function surfacesFor(config: ClientConfig, opts?: Parameters<typeof createCrmPage>[1]) {
  const Page = createCrmPage(config, opts);
  return (Page({}) as { props: { surfaces: readonly string[] } }).props.surfaces;
}

const base: ClientConfig = {
  slug: "test",
  domain: "example.com",
  brand: { name: "Test", colors: { primary: "#000", primaryDark: "#000" } },
  data: { adapter: "supabase", projectRef: "abc" },
  modules: ["crm"],
};

describe("crm surfaces", () => {
  it("gives a client every surface by default", () => {
    expect(surfacesFor(base)).toEqual(["pipeline", "cases", "accounts", "contacts", "tasks"]);
  });

  it("keeps the pipeline when another module (forensic-case) is enabled", () => {
    expect(surfacesFor({ ...base, modules: ["crm", "forensic-case"] })).toEqual(ALL_CRM_SURFACES);
  });

  it("narrows only when the app passes surfaces explicitly", () => {
    expect(surfacesFor(base, { surfaces: CASE_FILE_SURFACES })).toEqual(["cases", "accounts", "contacts"]);
  });
});
