import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const QUOTE_ENGINE_MODULE_ID = "quote-engine";

export const quoteEngineModule = {
  id: QUOTE_ENGINE_MODULE_ID,
  name: "Quote Engine",
  description:
    "Supabase-backed walkthrough intake, add-on pricing, and on-demand commercial cleaning quote PDFs.",
  routes: ["/intake", "/api/inspection", "/quote/[token]", "/api/quote/[token]"],
  dataAdapters: ["supabase"],
  audience: "mixed",
} satisfies ClientModule;


export const quoteEngineMounts = [
  {
    moduleId: QUOTE_ENGINE_MODULE_ID,
    kind: "page",
    route: "/intake",
    appFile: "app/intake/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-quote-engine/page",
  },
  {
    moduleId: QUOTE_ENGINE_MODULE_ID,
    kind: "route",
    route: "/api/inspection",
    appFile: "app/api/inspection/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-quote-engine/routes",
    methods: ["GET", "POST", "PATCH"],
  },
  // Customer-facing, token-gated. Unlike /intake and /api/inspection these are
  // reachable without staff auth — the public_token in the path is the entire
  // credential. The app file must also re-export publicQuoteMetadata (noindex)
  // and publicQuoteDynamic (force-dynamic) from ./public-page.
  {
    moduleId: QUOTE_ENGINE_MODULE_ID,
    kind: "page",
    route: "/quote/[token]",
    appFile: "app/quote/[token]/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-quote-engine/public-page",
  },
  {
    moduleId: QUOTE_ENGINE_MODULE_ID,
    kind: "route",
    route: "/api/quote/[token]",
    appFile: "app/api/quote/[token]/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-quote-engine/routes",
    methods: ["GET", "POST"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = quoteEngineMounts;

export type {
  AddonCatalogItem,
  ComputeMonthlyInput,
  Inspection,
  InspectionStatus,
  PricingConfig,
  PublicQuoteAddon,
  PublicQuoteLine,
  PublicQuotePricing,
  PublicQuoteTotals,
  PublicQuoteView,
  QuoteAddon,
  QuoteResolutionInput,
  ResolvedQuote,
  StandardService,
  TaskLibraryRow,
} from "./types";
export { INSPECTION_STATUSES } from "./types";
export type {
  BaseLineSource,
  LineOrigin,
  LineWritePlan,
  ManualLineInput,
  QuoteLineItem,
  QuoteLineItemInput,
  QuoteTotals,
} from "./line-items";
export {
  ADDON_KEY_PREFIX,
  BASE_LINE_KEY,
  EMPTY_LINE_PLAN,
  MANUAL_SORT_BASE,
  addonLineKey,
  buildAddonLines,
  buildBaseLine,
  buildGeneratedLines,
  computeTotals,
  isEmptyLinePlan,
  lineTax,
  lineTotal,
  planGeneratedLines,
  planManualLines,
  reconcileLines,
} from "./line-items";
export {
  CUSTOMER_VISIBLE_STATUSES,
  DEFAULT_QUOTE_VALID_DAYS,
  STATUS_TRANSITIONS,
  TERMINAL_STATUSES,
  canTransition,
  computeValidUntil,
  effectiveStatus,
  isQuoteActionable,
  isQuoteExpired,
  statusLabel,
  toPublicQuoteView,
} from "./lifecycle";
