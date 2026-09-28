import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { LeadForm } from "./ui";

export function createContactPage(clientConfig: ClientConfig) {
  return function ContactPage() {
    return (
      <LeadForm
        title={`Contact ${clientConfig.brand.name}`}
        intro="Send the details and the team will follow up."
      />
    );
  };
}
