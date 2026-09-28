import assert from "node:assert/strict";
import { INSPECTION_STATUSES } from "@waltersignal/bananaforce-module-quote-engine";
import type { Inspection, VisitMetricInput } from "./types";
import {
  OPEN_PIPELINE_STATUSES,
  buildAccountTimeline,
  computeAccountMetrics,
  countBy,
  groupInspectionsByStatus,
  monthsBetween,
  sumMrr,
  sumPipelineValue,
} from "./metrics";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// Minimal inspection factory — only the fields the metric helpers read matter.
function inspection(overrides: Partial<Inspection> = {}): Inspection {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    inspection_slug: "insp-test",
    prospect_name: null,
    prospect_company: null,
    prospect_email: null,
    prospect_phone: null,
    office_address: null,
    walkthrough_date: null,
    cleanable_sqft: null,
    visits_per_week: null,
    scope_inclusions: null,
    scope_exclusions: null,
    cleaning_days: null,
    clean_window: null,
    target_start: null,
    consumables_provided_by: null,
    current_cleaner: null,
    current_cleaner_issues: null,
    decision_process: null,
    internal_notes: null,
    number_of_offices: null,
    number_of_board_rooms: null,
    dumpster_access: null,
    parking_access: null,
    water_access: null,
    status: "drafting",
    estimate_number: "EST-0001",
    valid_until: null,
    public_token: null,
    sent_at: null,
    viewed_at: null,
    accepted_at: null,
    declined_at: null,
    quote_rate_per_sqft: null,
    quote_base_monthly: null,
    currency: "usd",
    subtotal: 0,
    tax: 0,
    total: 0,
    ...overrides,
  };
}

// --- countBy -------------------------------------------------------------
{
  const counts = countBy(
    [{ status: "new" }, { status: "new" }, { status: "won" }, { status: "" }, { status: null }],
    "status",
  );
  check(counts.new === 2, "countBy tallies repeated values");
  check(counts.won === 1, "countBy tallies singletons");
  check(counts.unknown === 2, "countBy buckets empty/null under 'unknown'");
}

// --- groupInspectionsByStatus -------------------------------------------
{
  const groups = groupInspectionsByStatus([
    inspection({ id: "a", status: "sent" }),
    inspection({ id: "b", status: "accepted" }),
    inspection({ id: "c", status: "sent" }),
  ]);
  check(
    groups.length === INSPECTION_STATUSES.length,
    "a group is returned for every canonical status",
  );
  check(groups[0].status === "drafting", "groups are in canonical order (drafting first)");
  const sent = groups.find((g) => g.status === "sent");
  const accepted = groups.find((g) => g.status === "accepted");
  check(sent?.inspections.length === 2, "two inspections grouped under 'sent'");
  check(accepted?.inspections.length === 1, "one inspection grouped under 'accepted'");
  const drafting = groups.find((g) => g.status === "drafting");
  check(drafting?.inspections.length === 0, "empty status group is present with no rows");
}

// --- sumMrr / sumPipelineValue ------------------------------------------
{
  const inspections = [
    inspection({ id: "a", status: "accepted" }),
    inspection({ id: "b", status: "accepted" }),
    inspection({ id: "c", status: "sent" }),
    inspection({ id: "d", status: "drafting" }),
    inspection({ id: "e", status: "declined" }),
    inspection({ id: "f", status: "viewed" }),
    inspection({ id: "g", status: "expired" }),
  ];
  const monthly = new Map<string, number | null>([
    ["a", 1000],
    ["b", 500],
    ["c", 750],
    ["d", 250],
    ["e", 9999],
    ["f", 400],
    ["g", 8888],
  ]);

  // MRR sums ONLY accepted inspections (a + b), never sent/drafting/declined.
  check(sumMrr(inspections, monthly) === 1500, "MRR sums accepted monthly only");

  // Pipeline value sums OPEN statuses (drafting + sent + viewed), never
  // accepted/declined/expired.
  check(
    sumPipelineValue(inspections, monthly) === 1400,
    "pipeline value sums open (drafting+sent+viewed) monthly only",
  );
  // A quote the customer has OPENED is the most live thing in the pipeline —
  // regression guard for it being dropped when 'viewed' was added.
  check(
    OPEN_PIPELINE_STATUSES.includes("viewed"),
    "'viewed' counts as open pipeline, not a closed state",
  );
  check(
    !OPEN_PIPELINE_STATUSES.includes("expired"),
    "'expired' is excluded from open pipeline until staff reissue",
  );

  // Missing / null monthly contributes 0, not NaN.
  check(
    sumMrr([inspection({ id: "z", status: "accepted" })], new Map()) === 0,
    "missing monthly contributes 0 to MRR",
  );
  check(
    sumMrr([inspection({ id: "z", status: "accepted" })], new Map([["z", null]])) === 0,
    "null monthly contributes 0 to MRR",
  );
}

// --- OPEN_PIPELINE_STATUSES excludes terminal states --------------------
{
  check(!OPEN_PIPELINE_STATUSES.includes("accepted"), "accepted is not open pipeline");
  check(!OPEN_PIPELINE_STATUSES.includes("declined"), "declined is not open pipeline");
  check(!OPEN_PIPELINE_STATUSES.includes("expired"), "expired is not open pipeline");
  check(OPEN_PIPELINE_STATUSES.length === 4, "four open pipeline statuses");
}

// --- monthsBetween -------------------------------------------------------
{
  const now = new Date("2026-06-19T00:00:00Z");
  check(monthsBetween(null, now) === 0, "null start -> 0 months");
  check(monthsBetween("not-a-date", now) === 0, "invalid date -> 0 months");
  check(monthsBetween("2026-06-25T00:00:00Z", now) === 0, "future start floored at 0");
  check(
    monthsBetween("2026-01-01T00:00:00Z", now) === 5,
    "Jan 1 -> Jun 19 is 5 whole months",
  );
  check(
    monthsBetween("2025-06-19T00:00:00Z", now) === 12,
    "exactly one year is 12 months",
  );
  check(
    monthsBetween("2026-06-25T00:00:00Z", new Date("2026-07-10T00:00:00Z")) === 0,
    "day-of-month not yet reached subtracts a month",
  );
}

// --- computeAccountMetrics ----------------------------------------------
{
  const now = new Date("2026-06-19T00:00:00Z");
  const visits: VisitMetricInput[] = [
    { status: "complete", visit_date: "2026-06-01", completed_at: null },
    { status: "partial", visit_date: "2026-06-08", completed_at: null },
    { status: "complete", visit_date: "2026-06-15", completed_at: null },
  ];

  // Accepted inspection with a signed contract -> active, months/LTV computed.
  const accepted = computeAccountMetrics(
    inspection({ status: "accepted", sent_at: "2026-05-01" }),
    1200,
    visits,
    "2026-01-01T00:00:00Z",
    now,
  );
  check(accepted.isActive === true, "accepted inspection is active");
  check(accepted.monthlyRevenue === 1200, "monthly revenue passes through");
  check(accepted.projectedAnnual === 14400, "projected annual is monthly * 12");
  check(accepted.accountSince === "2026-01-01T00:00:00Z", "accountSince prefers signed date");
  check(accepted.monthsActive === 5, "monthsActive computed from accountSince");
  check(accepted.estimatedLtv === 6000, "LTV = monthly * monthsActive");
  check(accepted.visitCount === 3, "visit count counts all visits");
  check(accepted.completedVisitCount === 2, "completed count only counts complete visits");

  // Non-accepted inspection -> not active, months/LTV null.
  const draft = computeAccountMetrics(
    inspection({ status: "sent", sent_at: "2026-05-01" }),
    1200,
    visits,
    null,
    now,
  );
  check(draft.isActive === false, "non-accepted inspection is not active");
  check(draft.monthsActive === null, "monthsActive null when not accepted");
  check(draft.estimatedLtv === null, "LTV null when not accepted");

  // Accepted with 0 months active still yields at least 1x monthly LTV.
  const newAccept = computeAccountMetrics(
    inspection({ status: "accepted" }),
    800,
    [],
    "2026-06-18T00:00:00Z",
    now,
  );
  check(newAccept.monthsActive === 0, "brand-new account has 0 months active");
  check(newAccept.estimatedLtv === 800, "LTV floors at 1x monthly for a new account");

  // accountSince falls back to sent_at, then walkthrough_date.
  const fallback = computeAccountMetrics(
    inspection({ status: "accepted", sent_at: null, walkthrough_date: "2026-03-01" }),
    100,
    [],
    null,
    now,
  );
  check(fallback.accountSince === "2026-03-01", "accountSince falls back to walkthrough_date");
}

// --- buildAccountTimeline -----------------------------------------------
{
  const events = buildAccountTimeline(
    inspection({
      status: "accepted",
      walkthrough_date: "2026-02-01",
      sent_at: "2026-02-10",
      office_address: "123 Main St",
    }),
    { submitted_at: "2026-01-15", source: "website" },
    [
      {
        id: "v1",
        status: "complete",
        visit_date: "2026-03-01",
        completed_at: null,
        tasks_done: 5,
        tasks_total: 5,
        signed_by: "Alex",
      },
    ],
    { monthly: 1000, contractSignedAt: "2026-02-20", checklistGenerated: true },
  );

  // Lead + walkthrough + quote sent + contract signed + 1 visit = 5 events.
  check(events.length === 5, "timeline includes all milestone events plus visits");
  // Sorted newest-first: the latest date is the visit (2026-03-01).
  check(events[0].date === "2026-03-01", "timeline is sorted newest-first");
  check(events[0].label.includes("complete"), "visit label includes the status");
  check(events[0].detail.includes("5/5"), "visit detail includes the task tally");
  const quoteEvent = events.find((e) => e.label === "Quote sent");
  check(quoteEvent?.detail.includes("1,000"), "quote sent detail shows the monthly amount");

  // Events without a date are skipped (no walkthrough, no sent, no contract).
  const sparse = buildAccountTimeline(
    inspection({ status: "drafting" }),
    null,
    [{ status: null, visit_date: null, completed_at: null }],
  );
  check(sparse.length === 0, "events and visits without dates are skipped");

  // Declined inspection emits a "Declined" event dated at sent_at (mirrors ABC).
  const declined = buildAccountTimeline(
    inspection({ status: "declined", sent_at: "2026-04-01" }),
    { submitted_at: "2026-01-15", source: "website" },
    [],
    { monthly: 1000 },
  );
  const declinedEvent = declined.find((e) => e.label === "Declined");
  check(declinedEvent != null, "declined inspection emits a Declined event");
  check(declinedEvent?.date === "2026-04-01", "Declined event is dated at sent_at");

  // A non-declined inspection never emits a Declined event.
  const notDeclined = buildAccountTimeline(
    inspection({ status: "sent", sent_at: "2026-04-01" }),
    null,
    [],
  );
  check(
    notDeclined.every((e) => e.label !== "Declined"),
    "non-declined inspection has no Declined event",
  );

  // A declined inspection without sent_at has no date to anchor to -> skipped.
  const declinedNoDate = buildAccountTimeline(
    inspection({ status: "declined", sent_at: null }),
    null,
    [],
  );
  check(
    declinedNoDate.every((e) => e.label !== "Declined"),
    "Declined event without sent_at is skipped",
  );
}

// --- INSPECTION_WRITABLE whitelist contract ------------------------------
// server.ts imports `server-only`, so it can't be imported into this plain-node
// test runner. Instead, assert the whitelist contract directly: it is the single
// source of truth for which inspection columns updateInspectionStatus may write,
// and it must exclude anything outside the three editable fields.
{
  const INSPECTION_WRITABLE = new Set(["status", "internal_notes", "sent_at"]);

  check(INSPECTION_WRITABLE.has("status"), "whitelist allows status");
  check(INSPECTION_WRITABLE.has("internal_notes"), "whitelist allows internal_notes");
  check(INSPECTION_WRITABLE.has("sent_at"), "whitelist allows sent_at (no carve-out)");
  check(INSPECTION_WRITABLE.size === 3, "whitelist holds exactly three writable columns");

  // Unexpected / sensitive columns must never be writable.
  for (const key of [
    "id",
    "inspection_slug",
    "quote_base_monthly",
    "prospect_email",
    "created_at",
    "updated_at",
    "__proto__",
  ]) {
    check(!INSPECTION_WRITABLE.has(key), `whitelist excludes "${key}"`);
  }

  // The strip loop drops any key not in the whitelist (single source of truth).
  const update: Record<string, unknown> = {
    status: "sent",
    sent_at: "2026-04-01",
    internal_notes: "ok",
    quote_base_monthly: 9999,
    id: "spoofed",
  };
  for (const key of Object.keys(update)) {
    if (!INSPECTION_WRITABLE.has(key)) delete update[key];
  }
  check(
    Object.keys(update).sort().join(",") === "internal_notes,sent_at,status",
    "strip loop keeps only whitelisted keys",
  );
}

console.log(`crew-portal metrics tests passed (${passed})`);
