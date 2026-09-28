import assert from "node:assert/strict";
import {
  EXPORT_SCHEDULE_OPTIONS,
  exportScheduleLabel,
  isScheduledExportDue,
  shouldExportWhenRecorded,
} from "./export-schedule";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const now = Date.UTC(2026, 5, 24, 12, 0, 0);

assert.equal(EXPORT_SCHEDULE_OPTIONS.length, 4);
assert.equal(exportScheduleLabel("manual"), "Manual only");
assert.equal(shouldExportWhenRecorded("when_recorded"), true);
assert.equal(shouldExportWhenRecorded("daily"), false);

assert.equal(isScheduledExportDue("manual", null, now), false);
assert.equal(isScheduledExportDue("when_recorded", null, now), false);
assert.equal(isScheduledExportDue("daily", null, now), true);
assert.equal(isScheduledExportDue("weekly", null, now), true);

assert.equal(
  isScheduledExportDue("daily", new Date(now - DAY + 1000).toISOString(), now),
  false,
);
assert.equal(
  isScheduledExportDue("daily", new Date(now - DAY - 1000).toISOString(), now),
  true,
);
assert.equal(
  isScheduledExportDue("weekly", new Date(now - WEEK + 1000).toISOString(), now),
  false,
);
assert.equal(
  isScheduledExportDue("weekly", new Date(now - WEEK - 1000).toISOString(), now),
  true,
);

console.log("export-schedule.test.ts: ok");
