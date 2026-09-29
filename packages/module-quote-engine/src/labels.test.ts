import assert from "node:assert/strict";
import { DEFAULT_QUOTE_LABELS, resolveQuoteLabels } from "./labels";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// --- omitting overrides must not change any existing deploy --------------
check(
  resolveQuoteLabels() === DEFAULT_QUOTE_LABELS,
  "no overrides returns the defaults object itself",
);
check(
  resolveQuoteLabels(null).documentTitle === "Commercial Cleaning Proposal",
  "null overrides keep the shipped janitorial wording",
);
check(
  JSON.stringify(resolveQuoteLabels({})) === JSON.stringify(DEFAULT_QUOTE_LABELS),
  "an empty override object is identical to the defaults",
);

// --- partial overrides ---------------------------------------------------
const industrial = resolveQuoteLabels({
  documentTitle: "Maintenance Services Proposal",
  serviceDescription: "Scheduled plant maintenance",
  measureUnit: "linear ft",
  scopeItemHeading: "WORK ITEM",
});
check(
  industrial.documentTitle === "Maintenance Services Proposal",
  "an overridden field takes the client's wording",
);
check(industrial.measureUnit === "linear ft", "the measured unit is overridable per vertical");
check(industrial.scopeItemHeading === "WORK ITEM", "scope column heads are overridable");
check(
  industrial.billingTermsValue === DEFAULT_QUOTE_LABELS.billingTermsValue,
  "fields the client did not override keep their defaults",
);

// --- blank values are treated as unfilled template fields ----------------
// A quote goes to a customer. An empty document title is far more likely to be
// an unfilled config field than a deliberate request for an untitled document.
check(
  resolveQuoteLabels({ documentTitle: "" }).documentTitle === DEFAULT_QUOTE_LABELS.documentTitle,
  "an empty-string override is ignored rather than blanking the heading",
);
check(
  resolveQuoteLabels({ totalCaption: "   " }).totalCaption === DEFAULT_QUOTE_LABELS.totalCaption,
  "a whitespace-only override is ignored",
);

// --- non-string junk from a JSON config cannot corrupt the document ------
check(
  resolveQuoteLabels({ annualLabel: 42 as unknown as string }).annualLabel ===
    DEFAULT_QUOTE_LABELS.annualLabel,
  "a non-string override is ignored",
);

// --- overriding cannot inject unknown keys -------------------------------
const injected = resolveQuoteLabels({ notALabel: "x" } as never);
check(
  !("notALabel" in injected),
  "unknown keys are dropped — the merge iterates the known label set, not the input",
);

console.log(`labels tests passed (${passed})`);
