// Service-role data access for the admin staff UI. Admin operates over the
// catalog + ordering commerce tables (products, product_wholesale_prices,
// inventory, customers, categories, vendors, locations, orders, order_items).
//
// MVP runtime path: every read/write here goes through the shared service-role
// client (data-supabase/service), which BYPASSES RLS. The staff_* RLS policies
// added in 0001_admin.sql are the FORWARD path (staff Supabase Auth); they are
// dormant at runtime. The ONLY gate at the edge is the deny-by-default
// `authorize` callback in routes.ts — never call these functions outside it.
//
// Guard every call with isAdminConfigured() and degrade gracefully (empties /
// null) when the env is missing, mirroring the quote-engine module's posture.

import "server-only";
import {
  attributePatchFromInput,
  attributeValue,
  attributesRecord,
  hasAttributePatch,
  isMissingAttributesColumnError,
  mergeAttributes,
} from "@waltersignal/bananaforce-core";
import { recordAudit, type AuditActor } from "@waltersignal/bananaforce-data-supabase/audit";
import { fetchAllRows } from "@waltersignal/bananaforce-data-supabase/pagination";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import type {
  AdminProduct,
  Category,
  Customer,
  CustomerTier,
  CustomerUpdateInput,
  InventoryRow,
  Location,
  Order,
  OrderItem,
  OrderStatus,
  ProductInventory,
  ProductUpdateInput,
  Vendor,
} from "./types";
import { canTransition } from "./types";

type AdminRow = Record<string, unknown>;

const MODULE_LABEL = "Admin";

const warn = (operation: string, error: unknown) =>
  warnSupabase(MODULE_LABEL, operation, error);

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

/**
 * Env-only check (no I/O), safe to import from anywhere. Admin requires the
 * service-role key (RLS-bypassing staff access); without it the module degrades
 * to setup-required empties rather than throwing.
 */
export function isAdminConfigured(): boolean {
  return isServiceRoleConfigured();
}

// The service-role client is shared from data-supabase — the single module that
// holds the service-role key (and is `server-only`). null when env is missing,
// so callers degrade to setup-required empties rather than throwing.
const getServiceClient = (operation: string) =>
  getServiceClientOrNull(MODULE_LABEL, operation);

const PRODUCT_ATTRIBUTE_FIELDS = ["effect_type", "shot_count", "gram_weight"] as const;

// --- row mappers ---------------------------------------------------------

function productFromRow(row: AdminRow): AdminProduct {
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
    wholesale_price: null,
  };
}

function categoryFromRow(row: AdminRow): Category {
  return {
    id: numberOrZero(row.id),
    name: stringOrNull(row.name) ?? "",
    sort_order: numberOrZero(row.sort_order),
  };
}

function vendorFromRow(row: AdminRow): Vendor {
  return {
    id: numberOrZero(row.id),
    name: stringOrNull(row.name) ?? "",
  };
}

function locationFromRow(row: AdminRow): Location {
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

function customerFromRow(row: AdminRow): Customer {
  return {
    id: stringOrNull(row.id) ?? "",
    email: stringOrNull(row.email),
    business_name: stringOrNull(row.business_name),
    tier: tierOrRetail(row.tier),
    tax_exempt: booleanOrFalse(row.tax_exempt),
    approved: booleanOrFalse(row.approved),
    resale_cert_url: stringOrNull(row.resale_cert_url),
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

function inventoryFromRow(row: AdminRow): InventoryRow {
  return {
    id: numberOrZero(row.id),
    product_id: numberOrZero(row.product_id),
    location_id: numberOrZero(row.location_id),
    qty: numberOrZero(row.qty),
  };
}

function orderItemFromRow(row: AdminRow): OrderItem {
  const product = (row.products ?? null) as AdminRow | AdminRow[] | null;
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

function orderFromRow(row: AdminRow): Order {
  const rawItems = (row.order_items ?? []) as AdminRow[];
  return {
    id: stringOrNull(row.id) ?? "",
    customer_id: stringOrNull(row.customer_id) ?? "",
    location_id: numberOrNull(row.location_id),
    status: statusOrCart(row.status),
    subtotal: numberOrZero(row.subtotal),
    notes: stringOrNull(row.notes),
    items: rawItems.map(orderItemFromRow),
    created_at: stringOrNull(row.created_at) ?? undefined,
  };
}

// --- catalog reference reads ---------------------------------------------

export async function listCategories(): Promise<Category[]> {
  const supabase = getServiceClient("listCategories");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("categories")
    .select("id,name,sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    warn("listCategories", error);
    return [];
  }
  return ((data ?? []) as AdminRow[]).map(categoryFromRow);
}

export async function listVendors(): Promise<Vendor[]> {
  const supabase = getServiceClient("listVendors");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("vendors")
    .select("id,name")
    .order("name", { ascending: true });

  if (error) {
    warn("listVendors", error);
    return [];
  }
  return ((data ?? []) as AdminRow[]).map(vendorFromRow);
}

export async function listLocations(): Promise<Location[]> {
  const supabase = getServiceClient("listLocations");
  if (!supabase) return [];

  // Staff see ALL locations (including non-public), unlike the public catalog.
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    warn("listLocations", error);
    return [];
  }
  return ((data ?? []) as AdminRow[]).map(locationFromRow);
}

// --- products + wholesale pricing ----------------------------------------

/**
 * All products (active and inactive) joined with their wholesale price. Staff
 * need the full list, not just is_active = true, so they can re-activate items.
 */
export async function listProducts(): Promise<AdminProduct[]> {
  const supabase = getServiceClient("listProducts");
  if (!supabase) return [];

  const { data, error } = await fetchAllRows<AdminRow>((from, to) =>
    supabase.from("products").select("*").order("name", { ascending: true }).range(from, to),
  );

  if (error) {
    warn("listProducts", error);
    return [];
  }

  const products = ((data ?? []) as AdminRow[]).map(productFromRow);
  if (products.length === 0) return products;

  const { data: priceRows, error: priceError } = await fetchAllRows<AdminRow>((from, to) =>
    supabase
      .from("product_wholesale_prices")
      .select("product_id,wholesale_price")
      .in(
        "product_id",
        products.map((p) => p.id),
      )
      .range(from, to),
  );

  if (priceError) {
    warn("listProducts:prices", priceError);
    return products;
  }

  const priceById = new Map<number, number>();
  for (const row of (priceRows ?? []) as AdminRow[]) {
    const id = numberOrNull(row.product_id);
    const price = numberOrNull(row.wholesale_price);
    if (id != null && price != null) priceById.set(id, price);
  }

  return products.map((p) => ({ ...p, wholesale_price: priceById.get(p.id) ?? null }));
}

const PRODUCT_WRITABLE_FIELDS: readonly (keyof ProductUpdateInput)[] = [
  "name",
  "category_id",
  "vendor_id",
  "brand_number",
  "pack",
  "sold_as",
  "retail_price",
  "unit_price",
  "promo_type",
  "deal_qty",
  "deal_price",
  "is_featured",
  "image_url",
  "upc",
  "effect_type",
  "shot_count",
  "gram_weight",
  "wholesale_excluded",
  "is_active",
  "description",
];

function pickProductFields(input: ProductUpdateInput): AdminRow {
  const patch: AdminRow = {};
  for (const field of PRODUCT_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  return patch;
}

async function productAttributesPatch(
  supabase: NonNullable<ReturnType<typeof getServiceClient>>,
  id: number,
  input: ProductUpdateInput,
): Promise<AdminRow | null> {
  const attributePatch = {
    ...attributesRecord(input.attributes),
    ...attributePatchFromInput(input as AdminRow, PRODUCT_ATTRIBUTE_FIELDS),
  };
  if (!hasAttributePatch(attributePatch)) return null;

  const { data, error } = await supabase
    .from("products")
    .select("attributes")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // Pre-migration (no attributes column): degrade to a legacy-only write.
    if (isMissingAttributesColumnError(error)) return null;
    // A real pre-fetch failure must ABORT the whole update — writing only the
    // legacy columns here would leave `attributes` stale and (post-backfill) the
    // attribute-preferring read would then serve the old value. Signal the caller.
    throw error;
  }

  return mergeAttributes((data as AdminRow | null)?.attributes, attributePatch);
}

export async function updateProduct(
  id: number,
  input: ProductUpdateInput,
): Promise<AdminProduct | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const supabase = getServiceClient("updateProduct");
  if (!supabase) return null;

  const patch = pickProductFields(input);
  let attributes: ReturnType<typeof mergeAttributes> | null;
  try {
    attributes = await productAttributesPatch(supabase, id, input);
  } catch (error) {
    // Never do a partial (legacy-only) write when the attributes side errored.
    warn("updateProduct:attributes", error);
    return null;
  }
  if (attributes) patch.attributes = attributes;
  // An empty patch is a malformed request, not a missing row. The route layer
  // rejects it with a 400 before reaching here; this is the defensive backstop.
  // (Callers that bypass the route should treat null-from-empty-patch as 400.)
  if (Object.keys(patch).length === 0) return null;

  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("updateProduct", error);
    return null;
  }
  return data ? productFromRow(data as AdminRow) : null;
}

/**
 * Set (upsert) a product's wholesale price. Pass null to clear it (delete the
 * row), so a product with no wholesale price falls back to retail in ordering.
 *
 * CONCURRENCY: this is NOT safe for concurrent calls on the SAME productId. The
 * null path (delete) and the number path (upsert) are separate statements with
 * no row lock between them, so two overlapping calls — e.g. one clearing and one
 * setting the same product's price — can interleave and leave the last writer's
 * result, or race the delete against the upsert. Admin pricing edits are a
 * single-operator, low-frequency action so this is acceptable for the MVP; if
 * concurrent edits per product become possible, guard this with a transaction
 * (e.g. a SECURITY DEFINER RPC doing the delete/upsert under a row lock).
 */
export async function setWholesalePrice(
  productId: number,
  price: number | null,
): Promise<boolean> {
  if (!Number.isInteger(productId) || productId <= 0) return false;
  const supabase = getServiceClient("setWholesalePrice");
  if (!supabase) return false;

  if (price == null) {
    const { error } = await supabase
      .from("product_wholesale_prices")
      .delete()
      .eq("product_id", productId);
    if (error) {
      warn("setWholesalePrice:delete", error);
      return false;
    }
    return true;
  }

  if (!Number.isFinite(price) || price < 0) return false;

  const { error } = await supabase
    .from("product_wholesale_prices")
    .upsert({ product_id: productId, wholesale_price: price }, { onConflict: "product_id" });

  if (error) {
    warn("setWholesalePrice:upsert", error);
    return false;
  }
  return true;
}

// --- customers / approvals -----------------------------------------------

export async function listCustomers(): Promise<Customer[]> {
  const supabase = getServiceClient("listCustomers");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("customers")
    .select("id,email,business_name,tier,tax_exempt,approved,resale_cert_url,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    warn("listCustomers", error);
    return [];
  }
  return ((data ?? []) as AdminRow[]).map(customerFromRow);
}

const CUSTOMER_WRITABLE_FIELDS: readonly (keyof CustomerUpdateInput)[] = [
  "tier",
  "approved",
  "tax_exempt",
];

export async function updateCustomer(
  id: string,
  input: CustomerUpdateInput,
): Promise<Customer | null> {
  if (!id) return null;
  const supabase = getServiceClient("updateCustomer");
  if (!supabase) return null;

  const patch: AdminRow = {};
  for (const field of CUSTOMER_WRITABLE_FIELDS) {
    if (field in input) patch[field] = input[field];
  }
  if (Object.keys(patch).length === 0) return null;

  const { data, error } = await supabase
    .from("customers")
    .update(patch)
    .eq("id", id)
    .select("id,email,business_name,tier,tax_exempt,approved,resale_cert_url,created_at")
    .maybeSingle();

  if (error) {
    warn("updateCustomer", error);
    return null;
  }
  return data ? customerFromRow(data as AdminRow) : null;
}

// --- inventory -----------------------------------------------------------

/**
 * Inventory grouped by product, each with its per-location quantities. Products
 * with no inventory rows are included with an empty byLocation so staff can add
 * the first quantity for a location.
 */
export async function listInventory(): Promise<ProductInventory[]> {
  const supabase = getServiceClient("listInventory");
  if (!supabase) return [];

  const { data: products, error: productError } = await fetchAllRows<AdminRow>((from, to) =>
    supabase
      .from("products")
      .select("id,name,item_number")
      .order("name", { ascending: true })
      .range(from, to),
  );

  if (productError) {
    warn("listInventory:products", productError);
    return [];
  }

  const productRows = (products ?? []) as AdminRow[];
  if (productRows.length === 0) return [];

  const { data: invRows, error: invError } = await fetchAllRows<AdminRow>((from, to) =>
    supabase.from("inventory").select("id,product_id,location_id,qty").range(from, to),
  );

  if (invError) {
    warn("listInventory:inventory", invError);
    return [];
  }

  const byProduct = new Map<number, InventoryRow[]>();
  for (const row of (invRows ?? []) as AdminRow[]) {
    const mapped = inventoryFromRow(row);
    const list = byProduct.get(mapped.product_id) ?? [];
    list.push(mapped);
    byProduct.set(mapped.product_id, list);
  }

  return productRows.map((row) => {
    const productId = numberOrZero(row.id);
    return {
      product_id: productId,
      product_name: stringOrNull(row.name) ?? "",
      item_number: numberOrZero(row.item_number),
      byLocation: (byProduct.get(productId) ?? []).sort(
        (a, b) => a.location_id - b.location_id,
      ),
    };
  });
}

/**
 * Set (upsert) the quantity for a product at a location. Conflicts on
 * (product_id, location_id) so re-adjusting overwrites instead of duplicating.
 */
export async function adjustInventory(
  productId: number,
  locationId: number,
  qty: number,
): Promise<boolean> {
  if (!Number.isInteger(productId) || productId <= 0) return false;
  if (!Number.isInteger(locationId) || locationId <= 0) return false;
  // Quantities are whole units; reject non-integers (and negatives) outright.
  if (!Number.isInteger(qty) || qty < 0) return false;

  const supabase = getServiceClient("adjustInventory");
  if (!supabase) return false;

  const { error } = await supabase
    .from("inventory")
    .upsert(
      { product_id: productId, location_id: locationId, qty },
      { onConflict: "product_id,location_id" },
    );

  if (error) {
    warn("adjustInventory", error);
    return false;
  }
  return true;
}

// --- orders --------------------------------------------------------------

const ADMIN_ORDER_SELECT =
  "id, customer_id, location_id, status, subtotal, notes, created_at, " +
  "order_items(id, order_id, product_id, qty, unit_price, line_total, products(name, item_number))";

/**
 * Order statuses surfaced in the admin Orders tab by default — everything
 * except live customer carts. Carts are in-flight customer state, not staff
 * work, so the default load excludes them (a staff member must opt in via an
 * explicit status filter to see carts).
 */
const ADMIN_NON_CART_STATUSES: readonly OrderStatus[] = [
  "submitted",
  "confirmed",
  "fulfilled",
  "cancelled",
];

/**
 * Orders newest-first. With no status, defaults to all NON-CART orders so the
 * admin Orders tab never shows / allows-cancel of live customer carts. Pass a
 * single status to filter to exactly that status (including "cart").
 */
export async function listOrders(status?: OrderStatus): Promise<Order[]> {
  const supabase = getServiceClient("listOrders");
  if (!supabase) return [];

  const { data, error } = await fetchAllRows<AdminRow>((from, to) => {
    let query = supabase
      .from("orders")
      .select(ADMIN_ORDER_SELECT)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    } else {
      query = query.in("status", ADMIN_NON_CART_STATUSES as OrderStatus[]);
    }

    return query.range(from, to) as PromiseLike<{
      data: AdminRow[] | null;
      error: { message: string } | null;
    }>;
  });

  if (error) {
    warn("listOrders", error);
    return [];
  }
  return data.map(orderFromRow);
}

/**
 * Advance an order's status (confirm / fulfill / cancel). Validates the
 * transition against canTransition() using the order's CURRENT status, so an
 * illegal jump (e.g. fulfilled -> confirmed) is rejected before any write.
 */
export async function advanceOrderStatus(
  orderId: string,
  to: OrderStatus,
  actor?: AuditActor | null,
): Promise<Order | null> {
  if (!orderId) return null;
  const supabase = getServiceClient("advanceOrderStatus");
  if (!supabase) return null;

  const { data: current, error: readError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();

  if (readError) {
    warn("advanceOrderStatus:read", readError);
    return null;
  }
  if (!current) return null;

  const from = statusOrCart((current as AdminRow).status);
  if (!canTransition(from, to)) {
    warn("advanceOrderStatus", `illegal transition ${from} -> ${to}`);
    return null;
  }

  // Re-assert the expected current status in the WHERE clause so a concurrent
  // update can't let an illegal transition slip through between read and write.
  const { data, error } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select(ADMIN_ORDER_SELECT)
    .maybeSingle();

  if (error) {
    warn("advanceOrderStatus:update", error);
    return null;
  }
  if (!data) return null;

  const order = orderFromRow(data as unknown as AdminRow);
  await recordAudit(supabase, {
    ...(actor ?? {}),
    action: "order.status_advanced",
    resource_type: "order",
    resource_id: order.id,
    before: { status: from },
    after: { status: order.status, order },
  });
  return order;
}
