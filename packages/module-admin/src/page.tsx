import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { createAdminDashboardPage } from "./admin-pages";

export function createAdminPage(_clientConfig: ClientConfig) {
  return createAdminDashboardPage();
}
