import { createOAuthCallbackRoute } from "@waltersignal/bananaforce-module-admin/oauth-callback-route";
import clientConfig from "../../../client.config";

export const dynamic = "force-dynamic";

export const GET = createOAuthCallbackRoute(clientConfig);
