import { describe, expect, it } from "vitest";
import { ALL_MODULES, MODULE_BY_ID } from "./index";

describe("expense module registration", () => {
  it("is present in the catalog", () => {
    expect(MODULE_BY_ID["expense"]).toBeDefined();
  });

  it("is a staff module with stable routes", () => {
    const expenseModule = MODULE_BY_ID["expense"];
    expect(expenseModule.audience).toBe("staff");
    expect(expenseModule.routes).toContain("/expenses");
    expect(expenseModule.routes).toContain("/api/expenses");
  });

  it("is supabase-only", () => {
    expect(MODULE_BY_ID["expense"].dataAdapters).toEqual(["supabase"]);
  });

  it("does not duplicate an existing module id", () => {
    const ids = ALL_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
