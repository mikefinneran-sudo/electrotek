import { createLicensesRouteHandlers } from "@waltersignal/bananaforce-module-licensing/routes";
import { staffAuthorize } from "../../../lib/authorize";

// Staff only: license records and documents are not part of the demo surface.
const handlers = createLicensesRouteHandlers({
  authorize: async () => staffAuthorize(),
});

export const dynamic = "force-dynamic";
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
