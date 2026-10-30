import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { getCorporateSnapshot, isCorporateInfoConfigured } from "./corporate";
import { CorporateInfoView } from "./corporate-ui";

export interface CorporateInfoPageOptions {
  authorize?: () => boolean | Promise<boolean>;
}

export function createCorporateInfoPage(
  clientConfig: ClientConfig,
  options: CorporateInfoPageOptions = {},
) {
  return async function CorporateInfoPage() {
    const title = `${clientConfig.brand.name} corporate info`;
    const allowed = options.authorize ? await Promise.resolve(options.authorize()) : false;

    if (!allowed) {
      return <CorporateInfoView title={title} notAuthorized />;
    }

    if (!isCorporateInfoConfigured()) {
      return <CorporateInfoView title={title} setupRequired />;
    }

    const snapshot = await getCorporateSnapshot();
    if (!snapshot) {
      return <CorporateInfoView title={title} loadError />;
    }

    return <CorporateInfoView title={title} initial={snapshot} />;
  };
}
