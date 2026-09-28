import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";
import type { CustomerTier } from "@waltersignal/bananaforce-module-catalog";

export const ORDERING_MODULE_ID = "ordering";

export const orderingModule = {
  id: ORDERING_MODULE_ID,
  name: "Ordering",
  description:
    "Supabase-backed cart, account auth, and offline-settlement order submission with email notify.",
  routes: ["/orders", "/account", "/sales", "/api/orders"],
  dataAdapters: ["supabase"],
  audience: "mixed",
  requires: ["catalog"],
} satisfies ClientModule;

// Ordering depends on the catalog module's commerce schema (customers,
// products, product_wholesale_prices, customer_tier). Catalog owns those
// tables; ordering owns only order_status, orders, and order_items.
export const ORDERING_REQUIRES = ["catalog"] as const;


export const orderingMounts = [
  {
    moduleId: ORDERING_MODULE_ID,
    kind: "page",
    route: "/orders",
    appFile: "app/orders/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-ordering/page",
  },
  {
    moduleId: ORDERING_MODULE_ID,
    kind: "page",
    route: "/account",
    appFile: "app/account/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-ordering/page",
  },
  {
    moduleId: ORDERING_MODULE_ID,
    kind: "page",
    route: "/sales",
    appFile: "app/sales/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-ordering/page",
  },
  {
    moduleId: ORDERING_MODULE_ID,
    kind: "route",
    route: "/api/orders",
    appFile: "app/api/orders/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-ordering/routes",
    methods: ["GET", "PATCH"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = orderingMounts;

export type OrderStatus =
  | "cart"
  | "submitted"
  | "confirmed"
  | "fulfilled"
  | "cancelled";

export interface OrderItem {
  id: number;
  order_id: string;
  product_id: number;
  qty: number;
  unit_price: number;
  line_total: number;
  product_name: string | null;
  item_number: number | null;
}

export interface Order {
  id: string;
  customer_id: string;
  location_id: number | null;
  status: OrderStatus;
  subtotal: number;
  notes: string | null;
  items: OrderItem[];
  created_at?: string;
}

export interface OrderAccount {
  id: string;
  email: string | null;
  business_name: string | null;
  tier: CustomerTier;
  tax_exempt: boolean;
  approved: boolean;
}

export interface OrderActionResult {
  ok: boolean;
  error?: string;
  setupRequired?: boolean;
  unauthorized?: boolean;
  emailSkipped?: boolean;
}

/** Pure subtotal recompute shared by actions and tests. */
export function computeSubtotal(items: { line_total: number }[]): number {
  const total = items.reduce((sum, item) => sum + Number(item.line_total ?? 0), 0);
  return Number(total.toFixed(2));
}

/** Pure line-total helper; rounded to cents to match numeric(10,2) storage. */
export function computeLineTotal(unitPrice: number, qty: number): number {
  return Number((unitPrice * qty).toFixed(2));
}
