import "server-only";
import {
  isOfflineSalesConfigured,
  listOrders,
  listSubmittedOrders,
  updateOrderStatus,
  type UpdateOrderStatusOptions,
} from "./staff-server";

export interface OrdersRouteOptions {
  authorize?: (request: Request, method: "GET" | "PATCH") => boolean | Promise<boolean>;
  /** Invoked when an order first reaches `fulfilled` (e.g. decrement stock). */
  onFulfilled?: UpdateOrderStatusOptions["onFulfilled"];
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
      error: "Offline sales is not configured. Contact your administrator.",
    },
    { status: 503 },
  );
}

function badRequest(error: string): Response {
  return json({ ok: false, error }, { status: 400 });
}

export function createOrdersRouteHandlers(options: OrdersRouteOptions) {
  const authorized = (request: Request, method: "GET" | "PATCH") =>
    options.authorize
      ? Promise.resolve(options.authorize(request, method))
      : Promise.resolve(false);

  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isOfflineSalesConfigured()) return setupRequired();

    const url = new URL(request.url);
    const entity = url.searchParams.get("entity") ?? "";

    if (entity === "submitted") {
      // Backward-compat: ?entity=submitted returns only submitted orders.
      const orders = await listSubmittedOrders();
      return json({ ok: true, orders });
    }

    if (entity === "orders") {
      // ?entity=orders&status=submitted|confirmed|fulfilled|cancelled
      // If no status param, returns all non-cart orders.
      const statusParam = url.searchParams.get("status") ?? undefined;
      const orders = await listOrders(statusParam);
      return json({ ok: true, orders });
    }

    return badRequest("A valid ?entity= parameter is required.");
  }

  async function PATCH(request: Request): Promise<Response> {
    if (!(await authorized(request, "PATCH"))) return unauthorized();
    if (!isOfflineSalesConfigured()) return setupRequired();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }

    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as Record<string, unknown>).id !== "string" ||
      typeof (body as Record<string, unknown>).status !== "string"
    ) {
      return badRequest("Body must include { id: string, status: string }.");
    }

    const { id, status } = body as { id: string; status: string };
    const validStatuses = ["confirmed", "fulfilled", "cancelled"];
    if (!validStatuses.includes(status)) {
      return badRequest(`status must be one of: ${validStatuses.join(", ")}.`);
    }

    const result = await updateOrderStatus(id, status, {
      onFulfilled: options.onFulfilled,
    });
    if (!result.ok) {
      return json({ ok: false, error: result.error }, { status: 422 });
    }
    return json({ ok: true });
  }

  return { GET, PATCH };
}
