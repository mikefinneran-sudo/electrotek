export type DataAdapter = "airtable" | "supabase";

export type AuthProvider = "google-oauth" | "supabase" | "jwt-token";

/**
 * Who a module is built for. Single source of truth for POV — operator nav,
 * route gating, and validation all read it so a module can never silently drift
 * between customer-facing and operator-facing again.
 *
 * - `public`   — no auth; anyone (marketing site).
 * - `customer` — the operator's end-customer (storefront, cart, token portal).
 * - `staff`    — the operator backend (the BananaFORCE console itself).
 * - `mixed`    — has both a customer/public AND a staff surface.
 */
export type ModuleAudience = "public" | "customer" | "staff" | "mixed";

export interface ClientBrand {
  name: string;
  logo?: string;
  colors?: {
    primary?: string;
    primaryDark?: string;
  };
}

export interface ClientVerticalConfig {
  /** Human business descriptor used for generic copy/prompts, e.g. "MRO distributor". */
  descriptor: string;
  /**
   * Declared attribute keys this client stores in products.attributes /
   * inspections.attributes. Phase 1: documentation + validation only — the
   * attribute writers still use the modules' hardcoded *_ATTRIBUTE_FIELDS. A
   * later phase will drive the writers from these.
   */
  productAttributes?: readonly string[];
  inspectionAttributes?: readonly string[];
}

/**
 * BYOK AI configuration, pointing at any OpenAI-compatible /chat/completions
 * endpoint (LiteLLM, vLLM, or the client's own provider). Stores env var NAMES,
 * never values — so swapping WalterSignal's interim gateway for the client's own
 * is an environment change, not a code change.
 */
export interface ClientAiConfig {
  baseUrlEnvVar: string;
  apiKeyEnvVar: string;
  model: string;
}

export interface ClientConfig {
  slug: string;
  domain: string;
  brand: ClientBrand;
  vertical?: string | ClientVerticalConfig;
  data: {
    adapter: DataAdapter;
    projectRef?: string;
    bases?: Record<string, string>;
  };
  auth?: {
    // Staff auth in the implemented modules is Supabase Auth (session cookies).
    staff?: {
      provider: AuthProvider;
      /** Staff landing route after sign-in. Defaults to /admin when unset. */
      staffHome?: string;
      /**
       * Google Workspace domain staff sign-ins must belong to, e.g.
       * "electrotekconsultants.com".
       *
       * Set this when the Google OAuth client's consent screen is External. An
       * Internal consent screen restricts sign-in to its own Workspace org and
       * needs nothing here -- but Internal requires a Cloud project owned by
       * that org, which not every client has. With External, the restriction has
       * to be enforced by us: `hd` steers the account chooser and the callback
       * rejects any other domain server-side.
       *
       * This is defence in depth, not the access gate. public.staff membership
       * is still what authorizes.
       */
      googleWorkspaceDomain?: string;
    };
    customer?: { provider: AuthProvider; tiers?: string[] };
  };
  ai?: ClientAiConfig;
  modules: string[];
}

export interface ClientModule {
  id: string;
  name: string;
  description: string;
  /** Point of view this module serves. Required — see {@link ModuleAudience}. */
  audience: ModuleAudience;
  routes?: string[];
  dataAdapters?: DataAdapter[];
  /**
   * Other module ids this module needs (shared schema, RLS helpers, or
   * cross-module reads). Enforced by validateClientConfig.
   */
  requires?: string[];
}

export type ModuleMountKind = "page" | "route" | "layout";

export interface ModuleMount<ModuleId extends string = string> {
  moduleId: ModuleId;
  kind: ModuleMountKind;
  route: string;
  appFile: string;
  entrypoint: string;
  methods?: readonly string[];
}

export interface ModuleRegistry {
  register(module: ClientModule): void;
  get(id: string): ClientModule | undefined;
  list(): ClientModule[];
  resolve(config: ClientConfig): ClientModule[];
}
