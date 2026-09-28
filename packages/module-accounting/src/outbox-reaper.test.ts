import assert from "node:assert/strict";
import { staleClaimFilter } from "./outbox-reaper";

const cutoff = "2026-06-24T11:45:00.000Z";

assert.equal(
  staleClaimFilter(cutoff),
  "claimed_at.lt.2026-06-24T11:45:00.000Z,and(claimed_at.is.null,created_at.lt.2026-06-24T11:45:00.000Z)",
  "stale means claimed before the cutoff, or unclaimed and created before it",
);

console.log("outbox-reaper.test.ts: ok");
