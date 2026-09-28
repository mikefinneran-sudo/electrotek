// Customer-visible wording on the quote document.
//
// These were hard-coded cleaning-vertical strings inside pdf.ts ("Commercial
// Cleaning Proposal", "Recurring commercial office cleaning", "TASK"/"FREQUENCY"
// column heads). That is wrong for any client whose vertical is not janitorial
// — the template config alone describes an industrial supply and maintenance
// back-office — and pdf.ts is a shared package, so a client cannot fix it
// without forking.
//
// Pure data and merging, no I/O. Defaults preserve the existing ABC wording
// exactly, so an existing deploy that passes nothing renders byte-identically.

export interface QuoteLabels {
  /** Document heading, e.g. "Commercial Cleaning Proposal". */
  documentTitle: string;
  /** Headline price caption. */
  totalCaption: string;
  /** Caption beside the headline price. */
  frequencyCaption: string;
  /** First row of the pricing table. */
  serviceDescriptionLabel: string;
  /** Sentence fragment describing the recurring service, before any sq ft. */
  serviceDescription: string;
  baseLabel: string;
  rateLabel: string;
  /** Prefix on each add-on row, e.g. "Add-on" -> "Add-on · Window washing". */
  addonPrefix: string;
  perVisitLabel: string;
  annualLabel: string;
  billingTermsLabel: string;
  billingTermsValue: string;
  /** Left column head of the scope table. */
  scopeItemHeading: string;
  /** Right column head of the scope table. */
  scopeFrequencyHeading: string;
  /** Unit shown for the measured quantity, e.g. "sq ft". */
  measureUnit: string;

  // --- line-item grid (quote_line_items) ---------------------------------
  // Only used when a quote has line items. A quote with none still renders the
  // sqft-and-add-ons summary and never reaches these.
  lineDescriptionHeading: string;
  lineQuantityHeading: string;
  lineUnitPriceHeading: string;
  lineTaxHeading: string;
  lineAmountHeading: string;
  subtotalLabel: string;
  taxLabel: string;
  grandTotalLabel: string;
}

/**
 * The wording ABC ships today. Any field a client does not override keeps
 * these, so adding this indirection changed no existing output.
 */
export const DEFAULT_QUOTE_LABELS: QuoteLabels = {
  documentTitle: "Commercial Cleaning Proposal",
  totalCaption: "Monthly investment",
  frequencyCaption: "Service frequency",
  serviceDescriptionLabel: "Service description",
  serviceDescription: "Recurring commercial office cleaning",
  baseLabel: "Base monthly (standard scope)",
  rateLabel: "Base rate",
  addonPrefix: "Add-on",
  perVisitLabel: "Estimated cost per visit",
  annualLabel: "Estimated annual investment",
  billingTermsLabel: "Billing terms",
  billingTermsValue: "Invoiced monthly in advance · Net 15 days",
  scopeItemHeading: "TASK",
  scopeFrequencyHeading: "FREQUENCY",
  measureUnit: "sq ft",
  lineDescriptionHeading: "DESCRIPTION",
  lineQuantityHeading: "QTY",
  lineUnitPriceHeading: "UNIT PRICE",
  lineTaxHeading: "TAX",
  lineAmountHeading: "AMOUNT",
  subtotalLabel: "Subtotal",
  taxLabel: "Tax",
  grandTotalLabel: "Total",
};

/**
 * Merge a client's partial overrides over the defaults.
 *
 * Empty strings are IGNORED rather than honoured: a config with
 * `documentTitle: ""` is far more likely to be an unfilled template field than
 * a deliberate request for an untitled quote, and a blank heading on a document
 * that goes to a customer is not a failure worth shipping.
 */
export function resolveQuoteLabels(overrides?: Partial<QuoteLabels> | null): QuoteLabels {
  if (!overrides) return DEFAULT_QUOTE_LABELS;

  const resolved: QuoteLabels = { ...DEFAULT_QUOTE_LABELS };
  for (const key of Object.keys(DEFAULT_QUOTE_LABELS) as (keyof QuoteLabels)[]) {
    const value = overrides[key];
    if (typeof value === "string" && value.trim() !== "") {
      resolved[key] = value;
    }
  }
  return resolved;
}
