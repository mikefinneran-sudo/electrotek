import { createForensicCaseRouteHandlers } from "@waltersignal/bananaforce-module-forensic-case/routes";
import { demoAuthorize, staffAuthorize } from "../../../lib/authorize";

const handlers = createForensicCaseRouteHandlers({
  authorize: async (_request, _method) => (await staffAuthorize()) || (await demoAuthorize()),
});

export const dynamic = "force-dynamic";
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
