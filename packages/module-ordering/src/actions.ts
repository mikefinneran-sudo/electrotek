"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { resolvePrice } from "@waltersignal/bananaforce-module-catalog/pricing";
import type { CustomerTier } from "@waltersignal/bananaforce-module-catalog";
import type { OrderActionResult } from "./index";
import { sendOrderNotification } from "./email";

type ServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;

const SETUP_ERROR = "Ordering is not configured. Contact your administrator.";

/**
 * Resolve the authenticated caller. Every action calls this first because
 * Server Actions are reachable by direct POST and must not trust UI gating.
 */
async function authedClient(): Promise<
  | { ok: true; supabase: ServerClient; userId: string; userEmail: string | null }
  | { ok: false; result: OrderActionResult }
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, result: { ok: false, setupRequired: true, error: SETUP_ERROR } };
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      result: { ok: false, unauthorized: true, error: "Sign in to manage your order." },
    };
  }

  return { ok: true, supabase, userId: user.id, userEmail: user.email ?? null };
}

/** Get the caller's open cart order id, creating one scoped to them if needed. */
async function getOrCreateCart(supabase: ServerClient, customerId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("customer_id", customerId)
    .eq("status", "cart")
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data: created, error } = await supabase
    .from("orders")
    .insert({ customer_id: customerId, status: "cart" })
    .select("id")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const { data: raced } = await supabase
        .from("orders")
        .select("id")
        .eq("customer_id", customerId)
        .eq("status", "cart")
        .maybeSingle();
      if (raced) return raced.id as string;
    }
    throw error;
  }
  return created.id as string;
}

/** Recompute and persist subtotal for a cart the caller owns. */
async function recomputeSubtotal(
  supabase: ServerClient,
  orderId: string,
): Promise<void> {
  const { error } = await supabase.rpc("ordering_recompute_cart_subtotal", {
    p_order_id: orderId,
  });
  if (error) throw error;
}

export async function addToOrder(formData: FormData): Promise<OrderActionResult> {
  const productId = Number(formData.get("productId"));
  const qty = Math.max(1, Math.trunc(Number(formData.get("qty") ?? 1)));

  if (!Number.isInteger(productId) || productId <= 0) {
    return { ok: false, error: "A valid product is required." };
  }

  const auth = await authedClient();
  if (!auth.ok) return auth.result;
  const { supabase, userId } = auth;

  try {
    // Capture the unit price for the customer's tier at add-time, not read-time.
    // RLS hides wholesale prices from non-approved customers, so an unauthorized
    // wholesale read simply yields null and falls back to retail.
    const { data: customer } = await supabase
      .from("customers")
      .select("tier")
      .eq("id", userId)
      .maybeSingle();
    const tier = ((customer?.tier as CustomerTier | undefined) ?? "retail") as CustomerTier;

    const { data: product } = await supabase
      .from("products")
      .select("retail_price, wholesale_excluded")
      .eq("id", productId)
      .eq("is_active", true)
      .maybeSingle();

    if (!product) {
      return { ok: false, error: "This product is not available." };
    }

    const { data: wholesale } = await supabase
      .from("product_wholesale_prices")
      .select("wholesale_price")
      .eq("product_id", productId)
      .maybeSingle();

    const { price } = resolvePrice({
      tier,
      retail: (product.retail_price as number | null) ?? null,
      wholesale: (wholesale?.wholesale_price as number | null) ?? null,
      wholesaleExcluded: product.wholesale_excluded === true,
    });
    // Reject rather than silently adding a $0 line for a product with no price.
    if (price == null) {
      return { ok: false, error: "This product has no price configured." };
    }
    const orderId = await getOrCreateCart(supabase, userId);

    // The RPC locks the cart, atomically increments the unique product line,
    // lets the DB price trigger resolve unit_price, and totals the cart in SQL.
    const { error: addError } = await supabase.rpc("ordering_add_cart_item", {
      p_order_id: orderId,
      p_product_id: productId,
      p_qty: qty,
    });
    if (addError) throw addError;

    revalidatePath("/orders");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function removeItem(formData: FormData): Promise<OrderActionResult> {
  const itemId = Number(formData.get("itemId"));
  const orderId = String(formData.get("orderId") ?? "");

  if (!Number.isInteger(itemId) || itemId <= 0 || !orderId) {
    return { ok: false, error: "A valid item is required." };
  }

  const auth = await authedClient();
  if (!auth.ok) return auth.result;
  const { supabase, userId } = auth;

  try {
    // Confirm the order is the caller's cart before mutating. RLS is the
    // backstop, but scope the write here too so a forged orderId cannot touch
    // another customer's rows even if a policy regresses.
    const { data: order } = await supabase
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .eq("customer_id", userId)
      .eq("status", "cart")
      .maybeSingle();

    if (!order) {
      return { ok: false, error: "Cart not found." };
    }

    await supabase.from("order_items").delete().eq("id", itemId).eq("order_id", orderId);
    await recomputeSubtotal(supabase, orderId);
    revalidatePath("/orders");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function submitOrder(formData: FormData): Promise<OrderActionResult> {
  const orderId = String(formData.get("orderId") ?? "");

  if (!orderId) {
    return { ok: false, error: "A valid order is required." };
  }

  const auth = await authedClient();
  if (!auth.ok) return auth.result;
  const { supabase, userId, userEmail } = auth;

  try {
    const { data: cart, error: cartError } = await supabase
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .eq("customer_id", userId)
      .eq("status", "cart")
      .maybeSingle();

    if (cartError) {
      return { ok: false, error: cartError.message };
    }

    if (!cart) {
      return { ok: false, error: "No open cart to submit." };
    }

    const { data: itemRows, error: itemError } = await supabase
      .from("order_items")
      .select("id, product_id")
      .eq("order_id", orderId);

    if (itemError) {
      return { ok: false, error: itemError.message };
    }

    const productIds = [
      ...new Set(
        (itemRows ?? [])
          .map((item) => Number((item as { product_id: number | null }).product_id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];

    if ((itemRows ?? []).length === 0 || productIds.length === 0) {
      return { ok: false, error: "Your cart is empty." };
    }

    const { data: products, error: productError } = await supabase
      .from("products")
      .select("id, is_active")
      .in("id", productIds);

    if (productError) {
      return { ok: false, error: productError.message };
    }

    const activeProductIds = new Set(
      (products ?? [])
        .filter((product) => (product as { is_active: boolean | null }).is_active === true)
        .map((product) => Number((product as { id: number }).id)),
    );
    const inactiveProductIds = productIds.filter((id) => !activeProductIds.has(id));
    if (inactiveProductIds.length > 0) {
      return { ok: false, error: "One or more products in your cart are no longer available." };
    }

    // Transition cart -> submitted, scoped to the caller's own cart. The
    // status = 'cart' predicate (mirrored in RLS) prevents re-submitting or
    // editing an already-submitted order.
    const { data: updated, error: updateError } = await supabase
      .from("orders")
      .update({ status: "submitted" })
      .eq("id", orderId)
      .eq("customer_id", userId)
      .eq("status", "cart")
      .select("id")
      .maybeSingle();

    if (updateError) {
      return { ok: false, error: updateError.message };
    }

    if (!updated) {
      return { ok: false, error: "No open cart to submit." };
    }

    let orderSubtotal = 0;
    try {
      const { data: orderRow } = await supabase
        .from("orders")
        .select("subtotal")
        .eq("id", orderId)
        .eq("customer_id", userId)
        .maybeSingle();
      orderSubtotal = Number(orderRow?.subtotal ?? 0);
    } catch {
      orderSubtotal = 0;
    }

    try {
      const { enqueueLedgerEvent } = await import(
        "@waltersignal/bananaforce-module-accounting/events"
      );
      await enqueueLedgerEvent({
        eventType: "order.submitted",
        sourceModule: "ordering",
        sourceId: orderId,
        payload: {
          order_id: orderId,
          amount: orderSubtotal,
        },
      });
    } catch {
      // Accounting module optional — never fail order submission.
    }

    // Notify the store for offline settlement. A failed email must NOT roll
    // back the submission, so any failure here is logged and swallowed.
    let emailSkipped = false;
    try {
      const { data: order } = await supabase
        .from("orders")
        .select(
          "id, subtotal, order_items(qty, unit_price, line_total, products(name, item_number))",
        )
        .eq("id", orderId)
        .eq("customer_id", userId)
        .single();

      const { data: customer } = await supabase
        .from("customers")
        .select("email, business_name, tier")
        .eq("id", userId)
        .maybeSingle();

      if (order) {
        type ItemRow = {
          qty: number;
          unit_price: number;
          line_total: number;
          products: { name: string; item_number: number | null } | { name: string; item_number: number | null }[] | null;
        };
        const rawItems = (order.order_items ?? []) as ItemRow[];
        const items = rawItems.map((item) => {
          const product = Array.isArray(item.products) ? item.products[0] ?? null : item.products;
          return {
            name: product?.name ?? "Unknown product",
            itemNumber: product?.item_number ?? null,
            qty: Number(item.qty),
            unitPrice: Number(item.unit_price),
            lineTotal: Number(item.line_total),
          };
        });

        const result = await sendOrderNotification({
          orderId: order.id as string,
          customerEmail: (customer?.email as string | null) ?? userEmail,
          businessName: (customer?.business_name as string | null) ?? null,
          tier: ((customer?.tier as CustomerTier | undefined) ?? "retail") as CustomerTier,
          subtotal: Number(order.subtotal),
          items,
        });

        emailSkipped = result.skipped === true;
        if (!result.ok && !result.skipped) {
          console.error("[order email] send failed:", result.error);
        }
      }
    } catch (emailError) {
      console.error("[order email] unexpected error:", emailError);
    }

    revalidatePath("/orders");
    return { ok: true, emailSkipped };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
