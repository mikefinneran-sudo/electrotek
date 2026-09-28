import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { warnSupabase } from "@waltersignal/bananaforce-data-supabase/server-helpers";
import { attributeValue, attributesRecord } from "@waltersignal/bananaforce-core";
import type {
  AvailabilityMap,
  AvailabilityStatus,
  Category,
  Customer,
  Location,
  Product,
  Vendor,
  WholesalePriceMap,
} from "./index";

type CatalogRow = Record<string, unknown>;

const MODULE_LABEL = "Catalog";

const warn = (operation: string, error: unknown) =>
  warnSupabase(MODULE_LABEL, operation, error);

async function getConfiguredClient(operation: string) {
  if (!isSupabaseConfigured()) return null;

  try {
    return await getSupabaseServerClient();
  } catch (error) {
    warn(operation, error);
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function booleanOrFalse(value: unknown): boolean {
  return value === true;
}

function availabilityOrOut(value: unknown): AvailabilityStatus {
  if (value === "in_stock" || value === "low_stock" || value === "out_of_stock") {
    return value;
  }
  return "out_of_stock";
}

function productFromRow(row: CatalogRow): Product {
  return {
    id: numberOrZero(row.id),
    item_number: numberOrZero(row.item_number),
    name: stringOrNull(row.name) ?? "",
    category_id: numberOrNull(row.category_id),
    vendor_id: numberOrNull(row.vendor_id),
    brand_number: stringOrNull(row.brand_number),
    upc: stringOrNull(row.upc),
    pack: stringOrNull(row.pack),
    sold_as: stringOrNull(row.sold_as),
    retail_price: numberOrNull(row.retail_price),
    unit_price: numberOrNull(row.unit_price),
    promo_type:
      row.promo_type === "bogo" || row.promo_type === "volume" ? row.promo_type : null,
    deal_qty: numberOrNull(row.deal_qty),
    deal_price: numberOrNull(row.deal_price),
    is_featured: row.is_featured === true,
    attributes: attributesRecord(row.attributes),
    effect_type: stringOrNull(attributeValue(row, "effect_type")),
    shot_count: numberOrNull(attributeValue(row, "shot_count")),
    gram_weight: numberOrNull(attributeValue(row, "gram_weight")),
    wholesale_excluded: booleanOrFalse(row.wholesale_excluded),
    is_active: row.is_active !== false,
    description: stringOrNull(row.description),
    image_url: stringOrNull(row.image_url),
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

function categoryFromRow(row: CatalogRow): Category {
  return {
    id: numberOrZero(row.id),
    name: stringOrNull(row.name) ?? "",
    sort_order: numberOrZero(row.sort_order),
  };
}

function vendorFromRow(row: CatalogRow): Vendor {
  return {
    id: numberOrZero(row.id),
    name: stringOrNull(row.name) ?? "",
  };
}

function locationFromRow(row: CatalogRow): Location {
  return {
    id: numberOrZero(row.id),
    slug: stringOrNull(row.slug) ?? "",
    name: stringOrNull(row.name) ?? "",
    address: stringOrNull(row.address),
    city: stringOrNull(row.city),
    state: stringOrNull(row.state),
    zip: stringOrNull(row.zip),
    phone: stringOrNull(row.phone),
    hours: stringOrNull(row.hours),
    lat: numberOrNull(row.lat),
    lng: numberOrNull(row.lng),
    is_public: row.is_public !== false,
    sort_order: numberOrZero(row.sort_order),
  };
}

function customerFromRow(row: CatalogRow): Customer {
  return {
    id: stringOrNull(row.id) ?? "",
    email: stringOrNull(row.email),
    business_name: stringOrNull(row.business_name),
    tier:
      row.tier === "wholesale_taxed" || row.tier === "wholesale_exempt"
        ? row.tier
        : "retail",
    tax_exempt: booleanOrFalse(row.tax_exempt),
    approved: booleanOrFalse(row.approved),
    resale_cert_url: stringOrNull(row.resale_cert_url),
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

export function isCatalogConfigured() {
  return isSupabaseConfigured();
}

export async function getCurrentCustomer(): Promise<Customer | null> {
  const supabase = await getConfiguredClient("getCurrentCustomer");
  if (!supabase) return null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data, error } = await supabase
      .from("customers")
      .select("id,email,business_name,tier,tax_exempt,approved,resale_cert_url,created_at")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      warn("getCurrentCustomer", error);
      return null;
    }

    return data ? customerFromRow(data as CatalogRow) : null;
  } catch (error) {
    warn("getCurrentCustomer", error);
    return null;
  }
}

export async function getCategories(): Promise<Category[]> {
  const supabase = await getConfiguredClient("getCategories");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("categories")
    .select("id,name,sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    warn("getCategories", error);
    return [];
  }

  return ((data ?? []) as CatalogRow[]).map(categoryFromRow);
}

export async function getVendors(): Promise<Vendor[]> {
  const supabase = await getConfiguredClient("getVendors");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("vendors")
    .select("id,name")
    .order("name", { ascending: true });

  if (error) {
    warn("getVendors", error);
    return [];
  }

  return ((data ?? []) as CatalogRow[]).map(vendorFromRow);
}

export async function getProducts(categoryId?: number): Promise<Product[]> {
  const supabase = await getConfiguredClient("getProducts");
  if (!supabase) return [];

  let query = supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (categoryId != null && Number.isFinite(categoryId)) {
    query = query.eq("category_id", categoryId);
  }

  const { data, error } = await query;

  if (error) {
    warn("getProducts", error);
    return [];
  }

  return ((data ?? []) as CatalogRow[]).map(productFromRow);
}

export async function getProduct(id: number): Promise<Product | null> {
  const supabase = await getConfiguredClient("getProduct");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    warn("getProduct", error);
    return null;
  }

  return data ? productFromRow(data as CatalogRow) : null;
}

export async function getWholesalePrices(productIds: number[]): Promise<WholesalePriceMap> {
  const ids = [...new Set(productIds.filter((id) => Number.isFinite(id)))];
  if (ids.length === 0) return {};

  const supabase = await getConfiguredClient("getWholesalePrices");
  if (!supabase) return {};

  const { data, error } = await supabase
    .from("product_wholesale_prices")
    .select("product_id,wholesale_price")
    .in("product_id", ids);

  if (error) {
    warn("getWholesalePrices", error);
    return {};
  }

  return ((data ?? []) as CatalogRow[]).reduce<WholesalePriceMap>((prices, row) => {
    const productId = numberOrNull(row.product_id);
    const price = numberOrNull(row.wholesale_price);
    if (productId != null && price != null) prices[productId] = price;
    return prices;
  }, {});
}

export async function getProductAvailability(productIds: number[]): Promise<AvailabilityMap> {
  const ids = [...new Set(productIds.filter((id) => Number.isFinite(id)))];
  if (ids.length === 0) return {};

  const supabase = await getConfiguredClient("getProductAvailability");
  if (!supabase) return {};

  const { data, error } = await supabase
    .from("product_availability")
    .select("product_id,availability")
    .in("product_id", ids);

  if (error) {
    warn("getProductAvailability", error);
    return {};
  }

  return ((data ?? []) as CatalogRow[]).reduce<AvailabilityMap>((availability, row) => {
    const productId = numberOrNull(row.product_id);
    if (productId != null) availability[productId] = availabilityOrOut(row.availability);
    return availability;
  }, {});
}

export async function getLocations(): Promise<Location[]> {
  const supabase = await getConfiguredClient("getLocations");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .eq("is_public", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    warn("getLocations", error);
    return [];
  }

  return ((data ?? []) as CatalogRow[]).map(locationFromRow);
}
