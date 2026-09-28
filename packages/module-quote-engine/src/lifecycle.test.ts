import assert from "node:assert/strict";
import {
  STATUS_TRANSITIONS,
  canTransition,
  computeValidUntil,
  effectiveStatus,
  isQuoteActionable,
  isQuoteExpired,
  statusLabel,
  toPublicQuoteView,
} from "./lifecycle";
import type { QuoteLineItem } from "./line-items";
import { INSPECTION_STATUSES } from "./types";
import type { Inspection, InspectionStatus, QuoteAddon } from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

function inspection(overrides: Partial<Inspection> = {}): Inspection {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    inspection_slug: "insp-abcd1234",
    prospect_name: "Dana Reyes",
    prospect_company: "Reyes Dental",
    prospect_email: "dana@example.com",
    prospect_phone: null,
    office_address: "100 Main St",
    walkthrough_date: "2026-07-01",
    cleanable_sqft: 10_000,
    visits_per_week: 3,
    scope_inclusions: "Vacuum\nRestrooms",
    scope_exclusions: "Windows",
    cleaning_days: "Mon, Wed, Fri",
    clean_window: "After 6pm",
    target_start: "2026-08-01",
    consumables_provided_by: "Provider",
    current_cleaner: "Acme Janitorial",
    current_cleaner_issues: "Misses restrooms",
    decision_process: "Owner decides",
    internal_notes: "Undercut Acme by 10%",
    number_of_offices: 4,
    number_of_board_rooms: 1,
    dumpster_access: "Rear lot",
    parking_access: "Street",
    water_access: "Janitor closet",
    status: "sent",
    estimate_number: "EST-0042",
    valid_until: "2026-08-30",
    public_token: "11111111-2222-3333-4444-555555555555",
    sent_at: "2026-07-31T15:00:00.000Z",
    viewed_at: null,
    accepted_at: null,
    declined_at: null,
    quote_rate_per_sqft: 0.01,
    quote_base_monthly: null,
    // Trigger-maintained. A quote with no lines reads 0, which is what an
    // add-on-only quote from before 0006 looks like.
    currency: "usd",
    subtotal: 0,
    tax: 0,
    total: 0,
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-31T15:00:00.000Z",
    ...overrides,
  };
}

// --- transition table mirrors the DB trigger -----------------------------
check(
  INSPECTION_STATUSES.every((s) => s in STATUS_TRANSITIONS),
  "every status in the enum has a transition entry",
);
check(canTransition("drafting", "ready_to_send"), "draft advances to ready_to_send");
check(!canTransition("drafting", "sent"), "draft cannot skip straight to sent");
check(canTransition("sent", "viewed"), "sent advances to viewed");
check(canTransition("viewed", "accepted"), "viewed can be accepted");
check(canTransition("sent", "accepted"), "sent can be accepted without an intervening view");
check(STATUS_TRANSITIONS.accepted.length === 0, "accepted is terminal");
check(!canTransition("accepted", "drafting"), "an accepted quote cannot be reopened");
check(canTransition("declined", "drafting"), "a declined quote can be revised");
check(canTransition("expired", "sent"), "an expired quote can be re-sent");
check(canTransition("sent", "sent"), "a same-status write is always allowed");

// --- expiry is date-only, in local calendar terms ------------------------
// Valid through the 30th means acceptable for all of the 30th. Naive timestamp
// comparison would expire this mid-afternoon on the 29th in US Eastern/Central.
const onLastDay = new Date(2026, 7, 30, 23, 30); // 2026-08-30, local
check(
  !isQuoteExpired({ valid_until: "2026-08-30" }, onLastDay),
  "a quote is still live at the end of its valid_until day",
);
check(
  isQuoteExpired({ valid_until: "2026-08-30" }, new Date(2026, 7, 31, 0, 1)),
  "a quote is expired the following day",
);
check(
  !isQuoteExpired({ valid_until: null }, onLastDay),
  "a quote with no valid_until never expires by date",
);

// --- actionability does not trust the stored status ----------------------
// quote_engine_expire_stale() is unscheduled, so a row can read 'sent' while
// its window has already closed. The DATE has to decide, not the column.
const stale = inspection({ status: "sent", valid_until: "2026-08-30" });
const afterWindow = new Date(2026, 8, 5);
check(!isQuoteActionable(stale, afterWindow), "an unswept past-window quote is not actionable");
check(
  effectiveStatus(stale, afterWindow) === "expired",
  "effectiveStatus folds an unswept expiry into 'expired'",
);
check(
  effectiveStatus(stale, onLastDay) === "sent",
  "effectiveStatus leaves a live quote's status alone",
);
check(isQuoteActionable(stale, onLastDay), "a quote inside its window is actionable");
check(
  !isQuoteActionable(inspection({ status: "accepted", valid_until: "2026-12-31" }), onLastDay),
  "an accepted quote is not actionable even inside its window",
);
check(
  !isQuoteActionable(inspection({ status: "drafting", valid_until: null }), onLastDay),
  "a draft is not customer-actionable",
);

// --- computeValidUntil ---------------------------------------------------
check(
  computeValidUntil("2026-07-31", 30) === "2026-08-30",
  "computeValidUntil adds the window in whole days",
);

// --- the public projection leaks nothing ---------------------------------
const addons: QuoteAddon[] = [
  { addon_id: "windows", name: "Window washing", price: 85, enabled: true },
  { addon_id: "odor", name: "Odor control", price: 45, enabled: false },
];
const view = toPublicQuoteView(inspection(), addons, [], onLastDay);
const serialized = JSON.stringify(view);

check(
  !serialized.includes("11111111-2222-3333-4444-555555555555"),
  "public view never carries public_token — it is the credential",
);
check(!serialized.includes("Undercut Acme"), "public view never carries internal_notes");
check(!serialized.includes("Acme Janitorial"), "public view never carries competitor intel");
check(!serialized.includes("Owner decides"), "public view never carries decision_process");
check(
  !("quote_rate_per_sqft" in (view as unknown as Record<string, unknown>)),
  "public view never carries the per-sqft rate (margin information)",
);
check(
  !("quote_base_monthly" in (view as unknown as Record<string, unknown>)),
  "public view never carries the raw base monthly input",
);
check(view.estimate_number === "EST-0042", "public view carries the customer-facing number");
check(view.addons.length === 1, "public view lists only enabled add-ons");
check(view.addons[0]?.name === "Window washing", "the enabled add-on is the one shown");
// 10,000 × 0.01 × (3 × 4.33 = 12.99) = 1299, + 85 enabled add-on.
check(view.pricing.monthly === 1384, "public view carries the resolved monthly total");
check(view.pricing.annual === 1384 * 12, "public view carries the annual total");
check(view.actionable === true, "a live sent quote is actionable in the public view");

// --- allow-list holds when a column is added -----------------------------
// The projection copies fields in explicitly, so an unknown column on the row
// cannot appear in a customer response.
const withNewColumn = {
  ...inspection(),
  secret_margin_pct: 42,
} as unknown as Inspection;
check(
  !JSON.stringify(toPublicQuoteView(withNewColumn, [], [], onLastDay)).includes("secret_margin_pct"),
  "a newly added column does not leak into the public view by default",
);

// --- the projection of LINE ITEMS ----------------------------------------
// Same allow-list discipline per line: which catalog item a line points at, and
// whether the operator typed it or the walkthrough generated it, are internal.
{
  const priced = {
    ...inspection(),
    subtotal: 1384,
    tax: 5.95,
    total: 1389.95,
    currency: "usd",
  } as Inspection;
  const lines: QuoteLineItem[] = [
    {
      id: "row-base",
      inspection_id: "insp-1",
      product_id: 77,
      sku: "SECRET-SKU-9",
      description: "Recurring service — monthly",
      quantity: 1,
      unit_price: 1299,
      line_total: 1299,
      tax_rate: 0,
      origin: "generated",
      origin_key: "base-service",
      sort_order: 0,
    },
    {
      id: "row-windows",
      inspection_id: "insp-1",
      product_id: null,
      sku: null,
      description: "Window washing",
      quantity: 1,
      unit_price: 85,
      line_total: 85,
      tax_rate: 7,
      origin: "generated",
      origin_key: "addon:windows",
      sort_order: 1,
    },
  ];

  const lineView = toPublicQuoteView(priced, addons, lines, onLastDay);
  const lineJson = JSON.stringify(lineView);

  check(lineView.lines.length === 2, "the public view carries the line grid");
  check(lineView.lines[0].description === "Recurring service — monthly", "descriptions come through");
  check(lineView.lines[0].line_total === 1299, "the stored line_total is used");
  check(lineView.lines[1].tax === 5.95, "per-line tax is projected in dollars, not as a rate");
  check(!lineJson.includes("SECRET-SKU-9"), "a line's sku never reaches the customer");
  check(!lineJson.includes("SECRET-SKU-9") && !lineJson.includes("\"product_id\""), "nor its catalog link");
  check(!lineJson.includes("origin_key"), "nor which generator produced it");
  check(
    lineView.totals?.total === 1389.95 && lineView.totals?.subtotal === 1384,
    "totals come from the inspection — the trigger owns them, not this code",
  );
  check(lineView.totals?.currency === "usd", "currency is carried");
  check(
    toPublicQuoteView(priced, addons, [], onLastDay).totals === null,
    "a quote with no lines reports null totals, not a fabricated zero",
  );
}

// --- labels --------------------------------------------------------------
check(statusLabel("ready_to_send") === "Ready to send", "statusLabel renders ready_to_send");
check(
  INSPECTION_STATUSES.every((s: InspectionStatus) => statusLabel(s).length > 0),
  "every status has a label",
);

console.log(`lifecycle tests passed (${passed})`);
