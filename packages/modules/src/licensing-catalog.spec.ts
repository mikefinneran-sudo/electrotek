import { describe, expect, it } from "vitest";
import { ALL_MODULES, MODULE_BY_ID } from "./index";

describe("licensing module registration", () => {
  it("is present in the catalog", () => {
    expect(MODULE_BY_ID["licensing"]).toBeDefined();
  });

  it("is a staff module with stable routes", () => {
    const licensingModule = MODULE_BY_ID["licensing"];
    expect(licensingModule.audience).toBe("staff");
    expect(licensingModule.routes).toContain("/licenses");
    expect(licensingModule.routes).toContain("/api/licenses");
  });

  it("is supabase-only", () => {
    expect(MODULE_BY_ID["licensing"].dataAdapters).toEqual(["supabase"]);
  });

  it("does not duplicate an existing module id", () => {
    const ids = ALL_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
