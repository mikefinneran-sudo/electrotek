import assert from "node:assert/strict";
import {
  advanceDueDate,
  filingDueStatus,
  isValidEin,
  isValidFiscalYearEnd,
  parseIsoDateOnly,
} from "./corporate-logic";

assert.equal(isValidEin("12-3456789"), true);
assert.equal(isValidEin("123456789"), false);
assert.equal(isValidEin("00-0000000"), true);

assert.equal(isValidFiscalYearEnd("12-31"), true);
assert.equal(isValidFiscalYearEnd("02-29"), true);
assert.equal(isValidFiscalYearEnd("02-31"), false);
assert.equal(isValidFiscalYearEnd("04-31"), false);
assert.equal(isValidFiscalYearEnd("12-31-2020"), false);

// Month-end anchoring recovers after a short month.
assert.equal(advanceDueDate("2025-02-28", "monthly"), "2025-03-31");

assert.equal(advanceDueDate("2024-01-31", "monthly"), "2024-02-29");
assert.equal(advanceDueDate("2025-01-31", "monthly"), "2025-02-28");
assert.equal(advanceDueDate("2024-03-31", "monthly"), "2024-04-30");
assert.equal(advanceDueDate("2026-04-30", "quarterly"), "2026-07-31");
assert.equal(advanceDueDate("2026-07-31", "quarterly"), "2026-10-31");
assert.equal(advanceDueDate("2026-10-31", "quarterly"), "2027-01-31");
assert.equal(advanceDueDate("2027-01-31", "quarterly"), "2027-04-30");
assert.equal(advanceDueDate("2024-02-29", "annual"), "2025-02-28");
assert.equal(advanceDueDate("2024-01-15", "quarterly"), "2024-04-15");
assert.equal(advanceDueDate("2024-01-15", "annual"), "2025-01-15");
assert.equal(advanceDueDate("2024-01-15", "biennial"), "2026-01-15");
assert.equal(advanceDueDate("2024-01-15", "one_time"), null);

assert.equal(filingDueStatus("2020-01-01", "2026-06-01"), "overdue");
assert.equal(filingDueStatus("2026-06-15", "2026-06-01"), "due_soon");
assert.equal(filingDueStatus("2026-08-01", "2026-06-01"), "ok");
assert.equal(filingDueStatus(null, "2026-06-01"), "none");

assert.equal(parseIsoDateOnly("2024-02-29")?.d, 29);
assert.equal(parseIsoDateOnly("2024-02-30"), null);

console.log("corporate-logic.test.ts: ok");
