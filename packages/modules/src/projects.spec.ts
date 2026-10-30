import { describe, expect, it } from "vitest";
import { ALL_MODULES, MODULE_BY_ID } from "./index";

describe("projects module registration", () => {
  it("is present in the catalog", () => {
    expect(MODULE_BY_ID.projects).toBeDefined();
  });

  it("has the stable mixed-audience routes", () => {
    expect(MODULE_BY_ID.projects.audience).toBe("mixed");
    expect(MODULE_BY_ID.projects.routes).toEqual([
      "/projects",
      "/projects/:id",
      "/api/projects",
    ]);
  });

  it("is supabase-only and does not duplicate an id", () => {
    expect(MODULE_BY_ID.projects.dataAdapters).toEqual(["supabase"]);
    const ids = ALL_MODULES.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
