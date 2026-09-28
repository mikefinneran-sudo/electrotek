// Admin module types. Admin operates over the catalog + ordering commerce
// tables, so it reuses their exported types wherever possible instead of
// redefining row shapes. Only admin-specific request/response shapes and the
// pure order-status transition contract live here.

import type {
  CustomerTier,
  Product,
} from "@waltersignal/bananaforce-module-catalog";
import type {
  Order,
  OrderItem,
  OrderStatus,
} from "@waltersignal/bananaforce-module-ordering";

// Re-export the reused catalog/ordering row types so consumers can import the
// whole admin surface from one place.
export type {
  Category,
  Customer,
  CustomerTier,
  Location,
  Product,
  Vendor,
} from "@waltersignal/bananaforce-module-catalog";
export type {
  Order,
  OrderItem,
  OrderStatus,
} from "@waltersignal/bananaforce-module-ordering";

/** Subset of product fields staff may edit through the admin catalog tab. */
export interface ProductUpdateInput {
  name?: string | null;
  category_id?: number | null;
  vendor_id?: number | null;
  brand_number?: string | null;
  pack?: string | null;
  sold_as?: string | null;
  retail_price?: number | null;
  attributes?: Record<string, unknown>;
  effect_type?: string | null;
  shot_count?: number | null;
  gram_weight?: number | null;
  wholesale_excluded?: boolean;
  is_active?: boolean;
  description?: string | null;
  unit_price?: number | null;
  promo_type?: "bogo" | "volume" | null;
  deal_qty?: number | null;
  deal_price?: number | null;
  is_featured?: boolean;
  image_url?: string | null;
  upc?: string | null;
}

/** Customer fields staff may set in the approvals tab. */
export interface CustomerUpdateInput {
  tier?: CustomerTier;
  approved?: boolean;
  tax_exempt?: boolean;
}

/** A product joined with its wholesale price for the pricing tab. */
export interface AdminProduct extends Product {
  wholesale_price: number | null;
}

/** A single per-location inventory quantity for the inventory tab. */
export interface InventoryRow {
  id: number;
  product_id: number;
  location_id: number;
  qty: number;
}

/** A product's inventory broken out per location (inventory tab row). */
export interface ProductInventory {
  product_id: number;
  product_name: string;
  item_number: number;
  byLocation: InventoryRow[];
}

/** An order surfaced in the admin orders tab (reuses the ordering Order). */
export type AdminOrder = Order;
export type AdminOrderItem = OrderItem;

/** Standardized result for admin mutations surfaced to the UI. */
export interface AdminActionResult {
  ok: boolean;
  error?: string;
  setupRequired?: boolean;
  unauthorized?: boolean;
}

/**
 * Staff-driven order status transitions. From a cart/submitted order, staff may
 * confirm, fulfill, or cancel. This is the only place transitions are encoded,
 * shared by the server layer and the unit test.
 *
 *   submitted -> confirmed | cancelled
 *   confirmed -> fulfilled | cancelled
 *   cart      -> cancelled            (abandon a never-submitted cart)
 *   fulfilled -> (terminal)
 *   cancelled -> (terminal)
 */
export const ADMIN_ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  cart: ["cancelled"],
  submitted: ["confirmed", "cancelled"],
  confirmed: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

/** Status values staff are allowed to move an order TO via the admin UI/API. */
export const ADMIN_TARGET_STATUSES: readonly OrderStatus[] = [
  "confirmed",
  "fulfilled",
  "cancelled",
];

/**
 * Whether `to` is a legal staff transition from `from`. Pure: no I/O, safe to
 * import anywhere and to unit-test directly. Both the route layer and server.ts
 * gate on this before issuing an update.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ADMIN_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
