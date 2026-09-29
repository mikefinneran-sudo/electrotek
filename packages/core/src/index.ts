export type {
  AttributeMap,
} from "./attributes";

export {
  attributePatchFromInput,
  attributeValue,
  attributesRecord,
  hasAttributePatch,
  isMissingAttributesColumnError,
  mergeAttributes,
} from "./attributes";

export type {
  AuthProvider,
  ClientAiConfig,
  ClientBrand,
  ClientConfig,
  ClientVerticalConfig,
  ClientModule,
  DataAdapter,
  ModuleAudience,
  ModuleMount,
  ModuleMountKind,
  ModuleRegistry,
} from "./types";

export { createRegistry, registerModule, validateClientConfig } from "./registry";

export type { DemoNavLink, DemoNavLinkTables, StaffLoginLink } from "./nav";

export { DEMO_OPS_NAV, DEMO_STORE_NAV, demoNavLinks, staffLoginLink } from "./nav";

export { runGuardedLoad } from "./guarded-load";

export type { FetchAction, FetchState } from "./fetch-state";

export { fetchStateReducer, initialFetchState } from "./fetch-state";

export const BANANAFORCE_TAGLINE = "Client deploy force";

export const PRODUCT_LINE = {
  fetch: "WalterFetch",
  force: "BananaFORCE",
  bot: "banana-bot",
} as const;
