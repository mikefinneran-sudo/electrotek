import { describe, expect, it } from "vitest";
import { formatUsd, resolvePrice } from "./pricing";

describe("resolvePrice", () => {
  it("shows anonymous and retail users retail pricing", () => {
    expect(resolvePrice({ retail: 12.5, wholesale: 8.25 })).toEqual({
      price: 12.5,
      label: "Retail",
      isWholesale: false,
      reason: "retail_customer",
    });
  });

  it("does not use wholesale pricing for the retail tier", () => {
    expect(
      resolvePrice({ tier: "retail", retail: 12.5, wholesale: 8.25 }),
    ).toEqual({
      price: 12.5,
      label: "Retail",
      isWholesale: false,
      reason: "retail_customer",
    });
  });

  it("uses visible wholesale pricing for approved wholesale users", () => {
    expect(
      resolvePrice({
        tier: "wholesale_taxed",
        retail: 12.5,
        wholesale: 8.25,
      }),
    ).toEqual({
      price: 8.25,
      label: "Wholesale",
      isWholesale: true,
      reason: "wholesale_visible",
    });
  });

  it("falls back wholesale users to retail when RLS hides the wholesale row", () => {
    expect(resolvePrice({ tier: "wholesale_exempt", retail: 12.5 })).toEqual({
      price: 12.5,
      label: "Retail",
      isWholesale: false,
      reason: "wholesale_hidden",
    });
  });

  it("falls back wholesale-excluded products to retail", () => {
    expect(
      resolvePrice({
        tier: "wholesale_exempt",
        retail: 12.5,
        wholesale: 8.25,
        wholesaleExcluded: true,
      }),
    ).toEqual({
      price: 12.5,
      label: "Retail",
      isWholesale: false,
      reason: "wholesale_excluded",
    });
  });
});

describe("formatUsd", () => {
  it("is a stable USD formatter", () => {
    expect(formatUsd(12.5)).toBe("$12.50");
  });

  it("handles missing prices", () => {
    expect(formatUsd(null)).toBe("N/A");
  });
});
