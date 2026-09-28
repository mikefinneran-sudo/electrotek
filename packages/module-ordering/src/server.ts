import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { warnSupabase } from "@waltersignal/bananaforce-data-supabase/server-helpers";
import type { CustomerTier } from "@waltersignal/bananaforce-module-catalog";
import type { Order, OrderAccount, OrderItem, OrderStatus } from "./index";
import { computeSubtotal } from "./index";

type OrderingRow = Record<string, unknown>;

const MODULE_LABEL = "Ordering";

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

function tierOrRetail(value: unknown): CustomerTier {
  return value === "wholesale_taxed" || value === "wholesale_exempt" ? value : "retail";
}

function statusOrCart(value: unknown): OrderStatus {
  if (
    value === "cart" ||
    value === "submitted" ||
    value === "confirmed" ||
    value === "fulfilled" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "cart";
}

function orderItemFromRow(row: OrderingRow): OrderItem {
  const product = (row.products ?? null) as OrderingRow | OrderingRow[] | null;
  // Supabase embeds a to-one relation as an object, but typings sometimes widen
  // it to an array; normalize defensively.
  const productRow = Array.isArray(product) ? (product[0] ?? null) : product;

  return {
    id: numberOrZero(row.id),
    order_id: stringOrNull(row.order_id) ?? "",
    product_id: numberOrZero(row.product_id),
    qty: numberOrZero(row.qty),
    unit_price: numberOrZero(row.unit_price),
    line_total: numberOrZero(row.line_total),
    product_name: productRow ? stringOrNull(productRow.name) : null,
    item_number: productRow ? numberOrNull(productRow.item_number) : null,
  };
}

function orderFromRow(row: OrderingRow): Order {
  const rawItems = (row.order_items ?? []) as OrderingRow[];
  const items = rawItems.map(orderItemFromRow);

  return {
    id: stringOrNull(row.id) ?? "",
    customer_id: stringOrNull(row.customer_id) ?? "",
    location_id: numberOrNull(row.location_id),
    status: statusOrCart(row.status),
    subtotal: numberOrZero(row.subtotal),
    notes: stringOrNull(row.notes),
    items,
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

export function isOrderingConfigured() {
  return isSupabaseConfigured();
}

/**
 * Whether the current request has an authenticated Supabase user. Returns false
 * (never throws) when unconfigured or unauthenticated so pages can branch
 * between the sign-in prompt and the empty-cart state.
 */
export async function isOrderingAuthenticated(): Promise<boolean> {
  const supabase = await getConfiguredClient("isOrderingAuthenticated");
  if (!supabase) return false;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return Boolean(user);
  } catch (error) {
    warn("isOrderingAuthenticated", error);
    return false;
  }
}

const ORDER_SELECT =
  "id, customer_id, location_id, status, subtotal, notes, created_at, " +
  "order_items(id, order_id, product_id, qty, unit_price, line_total, products(name, item_number))";

/**
 * The signed-in customer's most recent order (their cart, if one exists).
 * Returns null when Supabase is unconfigured or the visitor is unauthenticated
 * so unauthenticated `/orders` renders an empty/sign-in state without throwing.
 */
export async function getCurrentOrder(): Promise<Order | null> {
  const supabase = await getConfiguredClient("getCurrentOrder");
  if (!supabase) return null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // Prefer the open cart; only fall back to the most recent order (e.g. a
    // just-submitted one, for the submitted banner) when no cart exists. A bare
    // "most recent" query would hide a new cart behind an older submitted order.
    const { data: cart, error: cartError } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("customer_id", user.id)
      .eq("status", "cart")
      .maybeSingle();

    if (cartError) {
      warn("getCurrentOrder", cartError);
      return null;
    }

    let data = cart;
    if (!data) {
      const { data: recent, error: recentError } = await supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("customer_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentError) {
        warn("getCurrentOrder", recentError);
        return null;
      }
      data = recent;
    }

    if (!data) return null;

    const row = data as unknown as OrderingRow;
    const order = orderFromRow(row);
    // Trust the DB subtotal (a real $0 is kept); derive only when it is truly
    // absent. orderFromRow coerces null→0, so check the raw row, not order.subtotal.
    if (row.subtotal == null) {
      order.subtotal = computeSubtotal(order.items);
    }
    return order;
  } catch (error) {
    warn("getCurrentOrder", error);
    return null;
  }
}

/**
 * The signed-in customer's account row (from the catalog-owned customers
 * table). Returns null when unconfigured or unauthenticated.
 */
export async function getOrderAccount(): Promise<OrderAccount | null> {
  const supabase = await getConfiguredClient("getOrderAccount");
  if (!supabase) return null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data, error } = await supabase
      .from("customers")
      .select("id, email, business_name, tier, tax_exempt, approved")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      warn("getOrderAccount", error);
      return null;
    }

    if (!data) return null;

    const row = data as OrderingRow;
    return {
      id: stringOrNull(row.id) ?? user.id,
      email: stringOrNull(row.email) ?? user.email ?? null,
      business_name: stringOrNull(row.business_name),
      tier: tierOrRetail(row.tier),
      tax_exempt: row.tax_exempt === true,
      approved: row.approved === true,
    };
  } catch (error) {
    warn("getOrderAccount", error);
    return null;
  }
}
