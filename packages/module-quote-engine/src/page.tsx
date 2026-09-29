import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { isQuoteEngineConfigured } from "./server";
import { IntakeView } from "./ui";

/**
 * Factory for the /intake page (the new page-factory pattern — see
 * module-catalog/src/page.tsx). Wires the wizard UI to the server config check
 * and the consuming app's brand.
 */
export function createIntakePage(clientConfig: ClientConfig) {
  return function IntakePage() {
    return (
      <IntakeView
        title={`${clientConfig.brand.name} walkthrough`}
        intro="Capture the walkthrough details and we'll draft the quote."
        setupRequired={!isQuoteEngineConfigured()}
      />
    );
  };
}
