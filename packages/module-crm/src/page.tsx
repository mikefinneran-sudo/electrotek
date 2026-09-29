import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { isCrmConfigured } from "./server";
import { ALL_CRM_SURFACES, CASE_FILE_SURFACES, CrmView } from "./ui";

/**
 * Factory for the /crm page. Wires the workspace to the server config check and
 * the consuming app's brand. Staff-auth only - the app is responsible for
 * guarding this route with its authorize callback before the page renders.
 *
 * A client running module-forensic-case gets the case-file surfaces and no
 * sales ones. That module exists because the client manages case files rather
 * than deals, so a pipeline board and an opportunity list describe somebody
 * else's job; the derivation lives here rather than in a per-client branch so
 * no client name appears in a shared package.
 */
export function createCrmPage(clientConfig: ClientConfig) {
  const surfaces = clientConfig.modules.includes("forensic-case")
    ? CASE_FILE_SURFACES
    : ALL_CRM_SURFACES;

  return function CrmPage() {
    return (
      <CrmView
        title={`${clientConfig.brand.name} CRM`}
        setupRequired={!isCrmConfigured()}
        surfaces={surfaces}
      />
    );
  };
}
