import { createAdminLoginPage } from "@waltersignal/bananaforce-module-admin/admin-pages";
import clientConfig from "../../../client.config";

export const dynamic = "force-dynamic";

export default createAdminLoginPage(clientConfig);
