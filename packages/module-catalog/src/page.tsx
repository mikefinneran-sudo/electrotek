import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { CatalogView } from "./ui";
import {
  getCategories,
  getCurrentCustomer,
  getProductAvailability,
  getProducts,
  getWholesalePrices,
  isCatalogConfigured,
} from "./server";

type CatalogSearchParams = {
  category?: string | string[];
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function categoryIdFromSearch(value: string | string[] | undefined) {
  const raw = firstParam(value);
  if (!raw) return undefined;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createCatalogPage(clientConfig: ClientConfig) {
  return async function CatalogPage({
    searchParams,
  }: {
    searchParams: Promise<CatalogSearchParams>;
  }) {
    const { category } = await searchParams;
    const activeCategoryId = categoryIdFromSearch(category);

    const [categories, products, customer] = await Promise.all([
      getCategories(),
      getProducts(activeCategoryId),
      getCurrentCustomer(),
    ]);
    const productIds = products.map((product) => product.id);
    // Only fetch wholesale prices for approved wholesale customers — unapproved
    // users never receive wholesale data in their render tree (RLS is the second gate).
    const wholesaleEligible =
      !!customer?.approved &&
      (customer.tier === "wholesale_taxed" || customer.tier === "wholesale_exempt");
    const [availability, wholesalePrices] = await Promise.all([
      getProductAvailability(productIds),
      wholesaleEligible
        ? getWholesalePrices(productIds)
        : Promise.resolve({} as Awaited<ReturnType<typeof getWholesalePrices>>),
    ]);

    return (
      <CatalogView
        brandName={clientConfig.brand.name}
        categories={categories}
        products={products}
        customer={customer}
        wholesalePrices={wholesalePrices}
        availability={availability}
        activeCategoryId={activeCategoryId}
        setupRequired={!isCatalogConfigured()}
      />
    );
  };
}
