import type { CustomerTier, Product } from "./index";

export type PriceLabel = "Retail" | "Wholesale";

export type PriceReason =
  | "retail_customer"
  | "wholesale_visible"
  | "wholesale_hidden"
  | "wholesale_excluded";

export interface ResolvePriceOptions {
  tier?: CustomerTier | null;
  retail: number | null;
  wholesale?: number | null;
  wholesaleExcluded?: boolean;
}

export interface ResolvedPrice {
  price: number | null;
  label: PriceLabel;
  isWholesale: boolean;
  reason: PriceReason;
}

export function isWholesaleTier(tier?: CustomerTier | null) {
  return tier === "wholesale_taxed" || tier === "wholesale_exempt";
}

export function tierLabel(tier: CustomerTier) {
  switch (tier) {
    case "wholesale_taxed":
      return "Wholesale (taxed)";
    case "wholesale_exempt":
      return "Wholesale (tax-exempt)";
    default:
      return "Retail";
  }
}

export function formatUsd(value: number | null | undefined, fallback = "N/A") {
  if (value == null) return fallback;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export const formatPrice = formatUsd;

export function resolvePrice(options: ResolvePriceOptions): ResolvedPrice {
  if (isWholesaleTier(options.tier)) {
    if (options.wholesaleExcluded) {
      return {
        price: options.retail,
        label: "Retail",
        isWholesale: false,
        reason: "wholesale_excluded",
      };
    }

    if (options.wholesale != null) {
      return {
        price: options.wholesale,
        label: "Wholesale",
        isWholesale: true,
        reason: "wholesale_visible",
      };
    }

    return {
      price: options.retail,
      label: "Retail",
      isWholesale: false,
      reason: "wholesale_hidden",
    };
  }

  return {
    price: options.retail,
    label: "Retail",
    isWholesale: false,
    reason: "retail_customer",
  };
}

export type RetailPriceDisplay = {
  primary: string;
  secondary?: string;
};

/** Whole-dollar deal prices render without cents (e.g. 3/$100). */
export function formatDealPrice(value: number) {
  if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 0.001) {
    return `$${Math.round(value)}`;
  }
  return formatUsd(value);
}

/** Retail shelf / promo copy (BOGO, volume deals). */
export function formatRetailDisplay(product: Product): RetailPriceDisplay {
  if (product.promo_type === "bogo" && product.unit_price != null) {
    return {
      primary: `${formatUsd(product.unit_price)} each`,
      secondary: "Buy 1 Get 1 Free",
    };
  }

  if (
    product.promo_type === "volume" &&
    product.unit_price != null &&
    product.deal_qty != null &&
    product.deal_price != null
  ) {
    return {
      primary: `${formatUsd(product.unit_price)} each or ${product.deal_qty}/${formatDealPrice(product.deal_price)}`,
    };
  }

  return { primary: formatUsd(product.retail_price) };
}

export function formatProductPrice(opts: {
  product: Product;
  tier?: CustomerTier | null;
  wholesale?: number | null;
}): { display: RetailPriceDisplay; label: PriceLabel; isWholesale: boolean } {
  const resolved = resolvePrice({
    tier: opts.tier,
    retail: opts.product.retail_price,
    wholesale: opts.wholesale,
    wholesaleExcluded: opts.product.wholesale_excluded,
  });

  if (resolved.isWholesale) {
    return {
      display: { primary: formatUsd(resolved.price) },
      label: "Wholesale",
      isWholesale: true,
    };
  }

  return {
    display: formatRetailDisplay(opts.product),
    label: "Retail",
    isWholesale: false,
  };
}
