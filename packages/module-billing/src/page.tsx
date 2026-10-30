import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { isBillingConfigured } from "./server";
import { BillingView } from "./ui";

/**
 * Factory for the /billing page. The server component only checks setup state;
 * BillingView loads invoices and performs mutations through /api/billing.
 */
export function createBillingPage(clientConfig: ClientConfig) {
  return function BillingPage({ newRecord = null }: { newRecord?: string | null } = {}) {
    const configured = isBillingConfigured();

    return (
      <BillingView
        title={`${clientConfig.brand.name} Billing`}
        setupRequired={!configured}
        openForm={newRecord === "invoice"}
      />
    );
  };
}
