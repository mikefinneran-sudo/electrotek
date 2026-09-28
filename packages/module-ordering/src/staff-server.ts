import "server-only";
import {
  getSupabaseServiceClient,
  isServiceRoleConfigured,
} from "@waltersignal/bananaforce-data-supabase/service";

type OrderRow = Record<string, unknown>;

export interface SubmittedOrderSummary {
  id: string;
  status: string;
  subtotal: number;
  created_at?: string;
  customer_email: string | null;
  business_name: string | null;
  item_count: number;
}

/**
 * Allowed status transitions for staff order management.
 * Only forward/terminal moves are permitted.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  submitted: ["confirmed", "cancelled"],
  confirmed: ["fulfilled", "cancelled"],
};

function warn(operation: string, error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  console.warn(`Ordering staff ${operation} failed: ${message}`);
}

export function isOfflineSalesConfigured(): boolean {
  return isServiceRoleConfigured();
}

function mapRows(rows: OrderRow[]): SubmittedOrderSummary[] {
  return rows.map((row) => {
    const customer = (row.customers ?? null) as OrderRow | OrderRow[] | null;
    const customerRow = Array.isArray(customer) ? (customer[0] ?? null) : customer;
    const items = (row.order_items ?? []) as OrderRow[];

    return {
      id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
      status: typeof row.status === "string" ? row.status : "submitted",
      subtotal: Number(row.subtotal ?? 0),
      created_at: typeof row.created_at === "string" ? row.created_at : undefined,
      customer_email:
        customerRow && typeof customerRow.email === "string" ? customerRow.email : null,
      business_name:
        customerRow && typeof customerRow.business_name === "string"
          ? customerRow.business_name
          : null,
      item_count: items.length,
    };
  });
}

/**
 * List non-cart orders. If `status` is provided, filters to that status only;
 * otherwise returns all orders that are not in "cart" state.
 */
export async function listOrders(status?: string): Promise<SubmittedOrderSummary[]> {
  if (!isOfflineSalesConfigured()) return [];

  let supabase;
  try {
    supabase = getSupabaseServiceClient();
  } catch (error) {
    warn("listOrders.client", error);
    return [];
  }
  if (!supabase) return [];

  const baseQuery = supabase
    .from("orders")
    .select(
      "id, status, subtotal, created_at, customers(email, business_name), order_items(id)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const { data, error } = await (status
    ? baseQuery.eq("status", status)
    : baseQuery.neq("status", "cart"));

  if (error) {
    warn("listOrders", error);
    return [];
  }

  return mapRows((data ?? []) as OrderRow[]);
}

/** Backward-compatible wrapper — returns submitted orders only. */
export async function listSubmittedOrders(): Promise<SubmittedOrderSummary[]> {
  return listOrders("submitted");
}

/**
 * Transition an order's status. Validates that the move is permitted before
 * writing, so callers can trust the error message is meaningful.
 */
/** Passed to onFulfilled when an order transitions into `fulfilled`. */
export interface FulfilledOrderContext {
  orderId: string;
  locationId: number | null;
  items: { product_id: number; qty: number }[];
}

export interface UpdateOrderStatusOptions {
  /**
   * Invoked once when an order first reaches `fulfilled`. Used to decrement
   * inventory at the app layer (so ordering stays decoupled from inventory).
   * Best-effort: a failure here is logged but does not roll back the status.
   */
  onFulfilled?: (ctx: FulfilledOrderContext) => Promise<void> | void;
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: string,
  options: UpdateOrderStatusOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!isOfflineSalesConfigured()) {
    return { ok: false, error: "Offline sales is not configured." };
  }

  let supabase;
  try {
    supabase = getSupabaseServiceClient();
  } catch (error) {
    warn("updateOrderStatus.client", error);
    return { ok: false, error: "Server configuration error." };
  }
  if (!supabase) return { ok: false, error: "Server configuration error." };

  // Fetch current status before deciding whether the transition is allowed.
  const { data: existing, error: fetchError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (fetchError || !existing) {
    return { ok: false, error: "Order not found." };
  }

  const currentStatus = String((existing as OrderRow).status ?? "");
  const allowedNext = ALLOWED_TRANSITIONS[currentStatus] ?? [];

  if (!allowedNext.includes(newStatus)) {
    return {
      ok: false,
      error: `Cannot transition from "${currentStatus}" to "${newStatus}".`,
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({ status: newStatus })
    .eq("id", orderId)
    .eq("status", currentStatus)
    .select("id")
    .maybeSingle();

  if (updateError) {
    warn("updateOrderStatus", updateError);
    return { ok: false, error: "Could not update order status." };
  }
  if (!updated) {
    return { ok: false, error: "Order status changed before this update completed." };
  }

  // First transition into `fulfilled` → hand the line items to the app-layer
  // hook so it can decrement inventory. Best-effort; never blocks the status.
  if (
    newStatus === "fulfilled" &&
    options.onFulfilled
  ) {
    try {
      const [{ data: order }, { data: items }] = await Promise.all([
        supabase.from("orders").select("location_id").eq("id", orderId).single(),
        supabase
          .from("order_items")
          .select("product_id, qty")
          .eq("order_id", orderId),
      ]);

      const locationRaw = (order as OrderRow | null)?.location_id;
      const locationId =
        typeof locationRaw === "number" ? locationRaw : null;
      const lineItems = ((items ?? []) as OrderRow[])
        .map((row) => ({
          product_id: Number(row.product_id),
          qty: Number(row.qty),
        }))
        .filter((i) => i.product_id > 0 && Number.isFinite(i.qty) && i.qty > 0);

      await options.onFulfilled({ orderId, locationId, items: lineItems });
    } catch (error) {
      warn("updateOrderStatus.onFulfilled", error);
    }
  }

  return { ok: true };
}
