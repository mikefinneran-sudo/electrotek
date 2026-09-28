import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { isForensicCaseConfigured } from "./server";
import { CaseFileView } from "./ui";

/**
 * Factory for the /cases page. Staff-auth only - the app guards this route with
 * its authorize callback before the page renders, exactly as /crm does.
 */
export function createCaseFilePage(clientConfig: ClientConfig) {
  return function CaseFilePage() {
    return (
      <CaseFileView
        title={`${clientConfig.brand.name} case files`}
        setupRequired={!isForensicCaseConfigured()}
      />
    );
  };
}
