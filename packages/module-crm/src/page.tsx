import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { isCrmConfigured } from "./server";
import { ALL_CRM_SURFACES, CrmView, type Tab } from "./ui";

/**
 * Factory for the /crm page. Wires the workspace to the server config check and
 * the consuming app's brand. Staff-auth only - the app is responsible for
 * guarding this route with its authorize callback before the page renders.
 *
 * Every client gets every surface unless its app passes `surfaces` explicitly
 * (e.g. CASE_FILE_SURFACES for a practice with no sales motion). Enabling
 * another module never narrows the CRM: deriving surfaces from
 * `clientConfig.modules` let turning on forensic-case silently remove the
 * pipeline from a client that sells.
 */
export function createCrmPage(
  clientConfig: ClientConfig,
  { surfaces = ALL_CRM_SURFACES }: { surfaces?: readonly Tab[] } = {},
) {

  return function CrmPage({ newRecord = null }: { newRecord?: string | null }) {
    return (
      <CrmView
        newRecord={newRecord}
        title={`${clientConfig.brand.name} CRM`}
        setupRequired={!isCrmConfigured()}
        surfaces={surfaces}
      />
    );
  };
}
