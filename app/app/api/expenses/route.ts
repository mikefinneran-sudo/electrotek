import { createExpensesRouteHandlers } from "@waltersignal/bananaforce-module-expense/routes";
import { demoAuthorize, staffAuthorize } from "../../../lib/authorize";

const handlers = createExpensesRouteHandlers({
  authorize: async (_request, _method) => (await staffAuthorize()) || (await demoAuthorize()),
});

export const dynamic = "force-dynamic";
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
