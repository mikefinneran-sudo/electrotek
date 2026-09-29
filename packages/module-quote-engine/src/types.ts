// Mirrors the public.inspection_status enum. Order matches the enum's declared
// order (see 0004_quote_lifecycle_enum.sql), not the lifecycle order.
export type InspectionStatus =
  | "drafting"
  | "ready_to_send"
  | "sent"
  | "viewed"
  | "accepted"
  | "declined"
  | "expired";

export const INSPECTION_STATUSES: readonly InspectionStatus[] = [
  "drafting",
  "ready_to_send",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
];

export type InspectionAttributes = Record<string, unknown>;

/**
 * The central walkthrough record. Mirrors the `inspections` table. Contract and
 * signature fields are intentionally absent — they belong to the contract-esign
 * module (Wave 2).
 */
export interface Inspection {
  id: string;
  inspection_slug: string;
  prospect_name: string | null;
  prospect_company: string | null;
  prospect_email: string | null;
  prospect_phone: string | null;
  office_address: string | null;
  walkthrough_date: string | null;
  attributes?: InspectionAttributes;
  cleanable_sqft: number | null;
  visits_per_week: number | null;
  scope_inclusions: string | null;
  scope_exclusions: string | null;
  cleaning_days: string | null;
  clean_window: string | null;
  target_start: string | null;
  consumables_provided_by: string | null;
  current_cleaner: string | null;
  current_cleaner_issues: string | null;
  decision_process: string | null;
  internal_notes: string | null;
  number_of_offices: number | null;
  number_of_board_rooms: number | null;
  dumpster_access: string | null;
  parking_access: string | null;
  water_access: string | null;
  status: InspectionStatus;
  /** Customer-facing document number, assigned at insert. Never changes. */
  estimate_number: string;
  /** Expiry date (YYYY-MM-DD). Null while drafting; fixed once sent. */
  valid_until: string | null;
  /**
   * SECRET — sole credential for the customer preview route.
   *
   * Nullable so a consumer can decline to carry it: a module that reads
   * inspections but has no business handing out quote links (crew-portal, for
   * one) maps it to null rather than propagating a credential into a
   * lower-trust surface. Only the quote-engine's own mapper populates it, and
   * only so the operator can build the share link. Nothing resolves a quote BY
   * this field in memory — the token arrives from the URL and is matched in the
   * database — so null here costs nothing.
   *
   * Must never reach a customer response; `toPublicQuoteView` omits it by
   * construction.
   */
  public_token: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  quote_rate_per_sqft: number | null;
  quote_base_monthly: number | null;
  /**
   * Money on the quote, summed from `quote_line_items` by the
   * `quote_engine_recompute_totals()` trigger.
   *
   * READ-ONLY from the application's side. Nothing here is ever written by
   * server.ts — the trigger fires for the service-role client too, so the
   * database is the one place totals can be computed without drifting from the
   * lines they came from. A quote with no lines reads 0, not null.
   */
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  created_at?: string;
  updated_at?: string;
}

/** A single add-on as shown to the customer — name and price only. */
export interface PublicQuoteAddon {
  name: string;
  price: number | null;
}

/**
 * One line as shown to the customer.
 *
 * Deliberately NOT the stored row: `product_id`, `sku`, `origin` and
 * `origin_key` are internal (which catalog item, and whether the operator typed
 * the line or the walkthrough generated it, are none of the customer's
 * business). What is left is the grid they are agreeing to pay.
 */
export interface PublicQuoteLine {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  /** Tax charged on this line, in dollars — not the rate. */
  tax: number;
}

/** Money on the quote, as summed by the DB trigger from the lines. */
export interface PublicQuoteTotals {
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
}

/**
 * The customer-facing projection of an inspection, served by the token-gated
 * preview route. Built by an allow-list in `toPublicQuoteView`, so internal
 * fields (public_token, internal_notes, decision_process, competitor intel,
 * pricing inputs) cannot leak by default when a column is added later.
 */
export interface PublicQuoteView {
  estimate_number: string;
  /** Folds an unswept expiry into 'expired' — see `effectiveStatus`. */
  status: InspectionStatus;
  prospect_name: string | null;
  prospect_company: string | null;
  office_address: string | null;
  walkthrough_date: string | null;
  scope_inclusions: string | null;
  scope_exclusions: string | null;
  cleaning_days: string | null;
  clean_window: string | null;
  target_start: string | null;
  cleanable_sqft: number | null;
  visits_per_week: number | null;
  sent_at: string | null;
  valid_until: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  /** Validity window has closed, regardless of stored status. */
  expired: boolean;
  /** Customer may still accept or decline. */
  actionable: boolean;
  /**
   * Kept alongside `lines` rather than replaced by them. The add-on rows still
   * drive the PDF's "available but not included" list, and a quote written
   * before line items existed has add-ons and no lines at all.
   */
  addons: PublicQuoteAddon[];
  /**
   * The line grid — the money, itemised. Empty on a quote that has no lines
   * yet, in which case `pricing` is the only breakdown available.
   */
  lines: PublicQuoteLine[];
  /**
   * Trigger-computed totals from `lines`. Null when the quote has no lines, so
   * a consumer can tell "this quote sums to zero" apart from "this quote is not
   * priced by line".
   */
  totals: PublicQuoteTotals | null;
  /**
   * RESOLVED totals only. quote_rate_per_sqft and quote_base_monthly are
   * deliberately absent: the per-sqft rate is margin information, and a
   * customer who can see both the rate and the sqft can reconstruct the
   * pricing model. They get the number they are being asked to agree to.
   */
  pricing: PublicQuotePricing;
}

export interface PublicQuotePricing {
  monthly: number | null;
  addonTotal: number;
  visitsPerMonth: number | null;
  perVisit: number | null;
  annual: number | null;
}

/** Per-inspection optional add-on line item. Mirrors the `quote_addons` table. */
export interface QuoteAddon {
  id?: number;
  inspection_id?: string;
  addon_id: string;
  name: string;
  price: number | null;
  enabled: boolean;
}

/** Reusable scope-task catalog row. Mirrors the `task_library` table. */
export interface TaskLibraryRow {
  id: number;
  task_name: string;
  default_frequency: string | null;
  area: string | null;
  match_keywords: string | null;
  sort_order: number;
  always_include: boolean;
  active: boolean;
}

/** A standard service included in every base quote (no separate charge). */
export interface StandardService {
  name: string;
  frequency: string;
  area: string;
}

/** A catalog add-on offered on quotes. `examplePrice` is a walkthrough hint only. */
export interface AddonCatalogItem {
  id: string;
  name: string;
  examplePrice: number;
  exampleUnit: string;
}

/** Pricing configuration knobs. Defaults mirror ABC's active Pricing Config. */
export interface PricingConfig {
  ratePerSqftPerVisit: number;
  minMonthly: number;
  weeksPerMonth: number;
}

/** Inputs to the pure monthly base calculation (rate × sqft × visits/mo). */
export interface ComputeMonthlyInput {
  sqft: number | null | undefined;
  ratePerSqftPerVisit: number | null | undefined;
  visitsPerWeek: number | string | null | undefined;
  minMonthly?: number;
  weeksPerMonth?: number;
}

/** Source for resolving a quote — the persisted inspection pricing/scope. */
export interface QuoteResolutionInput {
  cleanable_sqft?: number | null;
  visits_per_week?: number | string | null;
  quote_rate_per_sqft?: number | null;
  quote_base_monthly?: number | null;
}

/** Fully resolved quote breakdown used by the preview and the PDF. */
export interface ResolvedQuote {
  monthly: number | null;
  baseMonthly: number | null;
  suggestedBase: number | null;
  addonTotal: number;
  addons: QuoteAddon[];
  ratePerSqft: number | null;
  visitsPerMonth: number | null;
  perVisit: number | null;
  annual: number | null;
  sqft: number | null;
  /** Which branch of the resolution hierarchy produced `monthly`. */
  source: "base_plus_addons" | "rate_times_sqft" | "addons_only" | "none";
}
