import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const CATALOG_MODULE_ID = "catalog";

export const catalogModule = {
  id: CATALOG_MODULE_ID,
  name: "Catalog",
  description: "Supabase-backed category browse, product detail, and tier-aware pricing.",
  routes: ["/catalog"],
  dataAdapters: ["supabase"],
  audience: "customer",
} satisfies ClientModule;


export const catalogMounts = [
  {
    moduleId: CATALOG_MODULE_ID,
    kind: "page",
    route: "/catalog",
    appFile: "app/catalog/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-catalog/page",
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = catalogMounts;

export type CustomerTier = "retail" | "wholesale_taxed" | "wholesale_exempt";

export interface Category {
  id: number;
  name: string;
  sort_order: number;
}

export interface Vendor {
  id: number;
  name: string;
}

export interface Location {
  id: number;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  hours: string | null;
  lat: number | null;
  lng: number | null;
  is_public: boolean;
  sort_order: number;
}

export type PromoType = "bogo" | "volume";

export type ProductAttributes = Record<string, unknown>;

export interface Product {
  id: number;
  item_number: number;
  name: string;
  category_id: number | null;
  vendor_id: number | null;
  brand_number: string | null;
  upc: string | null;
  pack: string | null;
  sold_as: string | null;
  retail_price: number | null;
  unit_price: number | null;
  promo_type: PromoType | null;
  deal_qty: number | null;
  deal_price: number | null;
  is_featured: boolean;
  attributes?: ProductAttributes;
  effect_type: string | null;
  shot_count: number | null;
  gram_weight: number | null;
  wholesale_excluded: boolean;
  is_active: boolean;
  description: string | null;
  image_url: string | null;
  created_at?: string;
}

export interface Customer {
  id: string;
  email: string | null;
  business_name: string | null;
  tier: CustomerTier;
  tax_exempt: boolean;
  approved: boolean;
  resale_cert_url?: string | null;
  created_at?: string;
}

export type AvailabilityStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface ProductAvailability {
  product_id: number;
  availability: AvailabilityStatus;
}

export type WholesalePriceMap = Record<number, number>;
export type AvailabilityMap = Record<number, AvailabilityStatus>;
