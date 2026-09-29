import type { ClientConfig } from "@waltersignal/bananaforce-core";
import {
  connectorStatus,
  countFailedOutbox,
  countPendingOutbox,
  getExportSettings,
  isAccountingConfigured,
} from "./server";
import { AccountingView } from "./ui";

export interface AccountingPageOptions {
  /**
   * Deny-by-default staff gate. Called before any accounting data is fetched.
   * When absent or false, the page renders a not-authorized state.
   */
  authorize?: () => boolean | Promise<boolean>;
}

/**
 * Factory for the /accounting page. Wires the staff view to the server config
 * check and the consuming app's brand.
 */
export function createAccountingPage(
  clientConfig: ClientConfig,
  options: AccountingPageOptions = {},
) {
  return async function AccountingPage() {
    const title = `${clientConfig.brand.name} accounting`;
    const allowed = options.authorize
      ? await Promise.resolve(options.authorize())
      : false;

    if (!allowed) {
      return <AccountingView title={title} notAuthorized />;
    }

    const configured = isAccountingConfigured();
    const status = configured
      ? await connectorStatus()
      : { tiller: false, wave: false };
    const pendingOutbox = configured ? await countPendingOutbox() : 0;
    const failedOutbox = configured ? await countFailedOutbox() : 0;
    const exportSettings = configured
      ? await getExportSettings()
      : {
          schedule: "when_recorded" as const,
          last_automatic_export_at: null,
          updated_at: new Date(0).toISOString(),
        };

    return (
      <AccountingView
        title={title}
        connectorStatus={status}
        setupRequired={!configured}
        pendingOutbox={pendingOutbox}
        failedOutbox={failedOutbox}
        exportSettings={exportSettings}
      />
    );
  };
}
