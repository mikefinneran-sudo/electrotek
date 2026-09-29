import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { isVisitCheckflowConfigured } from "./server";
import { VisitView } from "./ui";

interface VisitSearchParams {
  inspectionId?: string;
  id?: string;
}

/**
 * Factory for the /visit page (the page-factory pattern — see
 * module-quote-engine/src/page.tsx and module-catalog/src/page.tsx). The crew
 * opens /visit?inspectionId=<uuid> to sign off a visit; the view fetches the
 * checklist + history client-side via the deny-by-default /api/visit route.
 */
export function createVisitPage(clientConfig: ClientConfig) {
  return async function VisitPage({
    searchParams,
  }: {
    searchParams: Promise<VisitSearchParams>;
  }) {
    const params = await searchParams;
    const inspectionId = params.inspectionId ?? params.id ?? "";

    return (
      <VisitView
        inspectionId={inspectionId}
        title={`${clientConfig.brand.name} visit signoff`}
        intro="Work the checklist, capture before/after photos, and submit the visit."
        setupRequired={!isVisitCheckflowConfigured()}
      />
    );
  };
}
