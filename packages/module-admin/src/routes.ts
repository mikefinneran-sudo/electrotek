// Route-handler factory for /api/admin. Mirrors quote-engine's
// createInspectionRouteHandlers: a deny-by-default `authorize` gate fronts every
// handler, because all admin operations run through the RLS-bypassing
// service-role client and the route layer is the ONLY gate. The consuming app
// re-exports the returned GET/POST from app/api/admin/route.ts.
//
//   GET   read a tab's data: ?resource=products|customers|inventory|orders|refs
//   POST  perform a mutation: { action, ...payload }
//
// Mutations are dispatched by an `action` discriminator rather than separate
// routes, so the app mounts a single /api/admin endpoint.


import type { AuditActor } from "@waltersignal/bananaforce-data-supabase/audit";
import {
  advanceOrderStatus,
  adjustInventory,
  isAdminConfigured,
  listCategories,
  listCustomers,
  listInventory,
  listLocations,
  listOrders,
  listProducts,
  listVendors,
  setWholesalePrice,
  updateCustomer,
  updateProduct,
} from "./server";
import type {
  CustomerTier,
  CustomerUpdateInput,
  OrderStatus,
  ProductUpdateInput,
} from "./types";
import { ADMIN_TARGET_STATUSES } from "./types";

export interface AdminRouteOptions {
  /**
   * Called before EVERY handler. Return true to allow the request. When absent,
   * all requests are rejected with 401 — there is no safe default for a
   * staff-only resource backed by the RLS-bypassing service-role client. The
   * consuming app wires in whatever staff auth it has (a shared-secret header
   * now, a staff Supabase session once that is in place).
   */
  authorize?: (
    request: Request,
    method: "GET" | "POST",
  ) => boolean | Promise<boolean>;
  getActor?: (request: Request) => AuditActor | null | Promise<AuditActor | null>;
}

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function unauthorized(): Response {
  return json({ ok: false, error: "Unauthorized." }, { status: 401 });
}

function setupRequired(): Response {
  return json(
    {
      ok: false,
      setupRequired: true,
      error: "Admin is not configured. Contact your administrator.",
    },
    { status: 503 },
  );
}

function badRequest(error: string): Response {
  return json({ ok: false, error }, { status: 400 });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isTier(value: unknown): value is CustomerTier {
  return (
    value === "retail" || value === "wholesale_taxed" || value === "wholesale_exempt"
  );
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    value === "cart" ||
    value === "submitted" ||
    value === "confirmed" ||
    value === "fulfilled" ||
    value === "cancelled"
  );
}

// Whitelist the product fields the route forwards to the server layer; unknown
// keys are dropped here so a payload can't write arbitrary columns. server.ts
// also picks writable fields as a second guard.
const PRODUCT_STRING_KEYS = [
  "name",
  "brand_number",
  "pack",
  "sold_as",
  "effect_type",
  "description",
] as const;
const PRODUCT_NUMBER_KEYS = [
  "category_id",
  "vendor_id",
  "retail_price",
  "shot_count",
  "gram_weight",
] as const;
const PRODUCT_BOOL_KEYS = ["wholesale_excluded", "is_active"] as const;

function pickProductInput(body: Record<string, unknown>): ProductUpdateInput {
  const input = {} as Record<string, unknown>;
  for (const key of PRODUCT_STRING_KEYS) {
    if (key in body) input[key] = body[key] === "" ? null : String(body[key]);
  }
  for (const key of PRODUCT_NUMBER_KEYS) {
    if (key in body) input[key] = numberOrNull(body[key]);
  }
  for (const key of PRODUCT_BOOL_KEYS) {
    if (key in body) input[key] = body[key] === true;
  }
  return input as ProductUpdateInput;
}

function pickCustomerInput(body: Record<string, unknown>): CustomerUpdateInput {
  const input: CustomerUpdateInput = {};
  if ("tier" in body && isTier(body.tier)) input.tier = body.tier;
  if ("approved" in body) input.approved = body.approved === true;
  if ("tax_exempt" in body) input.tax_exempt = body.tax_exempt === true;
  return input;
}

export function createAdminRouteHandlers(options: AdminRouteOptions) {
  // Deny-by-default: with no authorize callback wired by the app, every request
  // is rejected. Admin is staff-only and served via the service-role client
  // (RLS is bypassed), so the route layer is the only gate.
  const authorized = (request: Request, method: "GET" | "POST") =>
    options.authorize
      ? Promise.resolve(options.authorize(request, method))
      : Promise.resolve(false);
  const actorFor = (request: Request) =>
    options.getActor ? Promise.resolve(options.getActor(request)) : Promise.resolve(null);

  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isAdminConfigured()) return setupRequired();

    const url = new URL(request.url);
    const resource = url.searchParams.get("resource") ?? "products";

    switch (resource) {
      case "refs": {
        const [categories, vendors, locations] = await Promise.all([
          listCategories(),
          listVendors(),
          listLocations(),
        ]);
        return json({ ok: true, categories, vendors, locations });
      }
      case "products": {
        const products = await listProducts();
        return json({ ok: true, products });
      }
      case "customers": {
        const customers = await listCustomers();
        return json({ ok: true, customers });
      }
      case "inventory": {
        const inventory = await listInventory();
        return json({ ok: true, inventory });
      }
      case "orders": {
        const statusParam = url.searchParams.get("status");
        const status = isOrderStatus(statusParam) ? statusParam : undefined;
        const orders = await listOrders(status);
        return json({ ok: true, orders });
      }
      default:
        return badRequest("Unknown resource.");
    }
  }

  async function POST(request: Request): Promise<Response> {
    if (!(await authorized(request, "POST"))) return unauthorized();
    if (!isAdminConfigured()) return setupRequired();

    const body = await readJson(request);
    const action = typeof body.action === "string" ? body.action : "";

    switch (action) {
      case "updateProduct": {
        const id = numberOrNull(body.id);
        if (id == null || !Number.isInteger(id) || id <= 0) {
          return badRequest("A valid product id is required.");
        }
        const input = pickProductInput(body);
        // Distinguish "no writable fields provided" (400) from "product not
        // found" (404): an empty patch is a malformed request, not a missing row.
        if (Object.keys(input).length === 0) {
          return badRequest("No writable product fields provided.");
        }
        const product = await updateProduct(id, input);
        if (!product) return json({ ok: false, error: "Could not update the product." }, { status: 404 });
        return json({ ok: true, product });
      }

      case "setWholesalePrice": {
        const productId = numberOrNull(body.product_id);
        if (productId == null || !Number.isInteger(productId) || productId <= 0) {
          return badRequest("A valid product id is required.");
        }
        // null clears the wholesale price; a number sets it.
        const rawPrice = body.wholesale_price;
        const price = rawPrice == null || rawPrice === "" ? null : numberOrNull(rawPrice);
        if (rawPrice != null && rawPrice !== "" && (price == null || price < 0)) {
          return badRequest("Wholesale price must be a non-negative number.");
        }
        const ok = await setWholesalePrice(productId, price);
        if (!ok) return json({ ok: false, error: "Could not set the wholesale price." }, { status: 500 });
        return json({ ok: true });
      }

      case "updateCustomer": {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) return badRequest("A customer id is required.");
        const input = pickCustomerInput(body);
        if (Object.keys(input).length === 0) {
          return badRequest("No customer fields to update.");
        }
        const customer = await updateCustomer(id, input);
        if (!customer) return json({ ok: false, error: "Could not update the customer." }, { status: 404 });
        return json({ ok: true, customer });
      }

      case "adjustInventory": {
        const productId = numberOrNull(body.product_id);
        const locationId = numberOrNull(body.location_id);
        const qty = numberOrNull(body.qty);
        if (productId == null || !Number.isInteger(productId) || productId <= 0) {
          return badRequest("A valid product id is required.");
        }
        if (locationId == null || !Number.isInteger(locationId) || locationId <= 0) {
          return badRequest("A valid location id is required.");
        }
        if (qty == null || !Number.isInteger(qty) || qty < 0) {
          return badRequest("Quantity must be a non-negative integer.");
        }
        const ok = await adjustInventory(productId, locationId, qty);
        if (!ok) return json({ ok: false, error: "Could not adjust inventory." }, { status: 500 });
        return json({ ok: true });
      }

      case "advanceOrder": {
        const orderId = typeof body.order_id === "string" ? body.order_id : "";
        if (!orderId) return badRequest("An order id is required.");
        if (!isOrderStatus(body.status) || !ADMIN_TARGET_STATUSES.includes(body.status)) {
          return badRequest("A valid target status is required (confirmed, fulfilled, or cancelled).");
        }
        const order = await advanceOrderStatus(orderId, body.status, await actorFor(request));
        if (!order) {
          return json(
            { ok: false, error: "Could not advance the order. The transition may not be allowed." },
            { status: 409 },
          );
        }
        return json({ ok: true, order });
      }

      default:
        return badRequest("Unknown action.");
    }
  }

  return { GET, POST };
}
