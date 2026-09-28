// Route-handler factory for /api/expenses.
//
//   GET    list expenses, or fetch one by ?id=.
//   PATCH  action-discriminated: void | confirm.
//
// Unlike module-asset-controls, this module reads and writes through the
// SESSION Supabase client (see server.ts), against tables gated by RLS
// (`to authenticated using (public.is_staff())`) — so a non-staff caller
// already gets no rows and no-op writes even with no `authorize` here. The
// `authorize` callback below is defence in depth, not the sole gate: it
// exists so a rejected request gets an explicit 401 instead of an empty-but-
// present 200/404 that reads as "you have no expenses" rather than "you are
// not allowed to see this."

import "server-only";
import { confirmExpense, getExpense, listExpenses, voidExpense } from "./server";
import type { ExpenseSubjectType } from "./types";

export interface ExpensesRouteOptions {
  /**
   * Called before EVERY handler. Return true to allow the request. When
   * absent, all requests are rejected with 401.
   */
  authorize?: (request: Request, method: "GET" | "PATCH") => boolean | Promise<boolean>;
}

function unauthorized(): Response {
  return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
}

export function createExpensesRouteHandlers(options: ExpensesRouteOptions = {}) {
  const authorized = (request: Request, method: "GET" | "PATCH") =>
    options.authorize ? Promise.resolve(options.authorize(request, method)) : Promise.resolve(false);

  return {
    async GET(request: Request): Promise<Response> {
      if (!(await authorized(request, "GET"))) return unauthorized();

      const id = new URL(request.url).searchParams.get("id");
      if (id) {
        const expense = await getExpense(id);
        return expense
          ? Response.json(expense)
          : Response.json({ error: "Not found" }, { status: 404 });
      }
      return Response.json({ expenses: await listExpenses() });
    },

    async PATCH(request: Request): Promise<Response> {
      if (!(await authorized(request, "PATCH"))) return unauthorized();

      const body = (await request.json()) as Record<string, unknown>;
      const action = String(body.action ?? "");

      if (action === "void") {
        const result = await voidExpense(String(body.id));
        return result.ok
          ? Response.json({ ok: true })
          : Response.json({ errors: result.errors }, { status: 400 });
      }

      if (action === "confirm") {
        // No staff_id read from the body: confirmed_by is audit data and
        // confirmExpense resolves it from the authenticated session itself.
        const result = await confirmExpense({
          id: String(body.id),
          vendor: String(body.vendor ?? ""),
          purchased_on: String(body.purchased_on ?? ""),
          total: Number(body.total),
          tax: body.tax === null || body.tax === undefined ? null : Number(body.tax),
          currency: String(body.currency ?? "usd"),
          category_id: body.category_id ? String(body.category_id) : null,
          subject_type: String(body.subject_type ?? "unattributed") as ExpenseSubjectType,
          subject_id: body.subject_id ? String(body.subject_id) : null,
          note: body.note ? String(body.note) : null,
        });
        return result.ok
          ? Response.json({ ok: true, id: result.id })
          : Response.json({ errors: result.errors }, { status: 400 });
      }

      return Response.json({ error: `Unknown action "${action}"` }, { status: 400 });
    },
  };
}
