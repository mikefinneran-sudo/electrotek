import assert from "node:assert/strict";
import {
  STATE_TTL_MS,
  createWaveOAuthState,
  verifyWaveOAuthState,
} from "./wave-oauth-state";

const originalWaveStateSecret = process.env.WAVE_STATE_SIGNING_SECRET;
const originalAccountingCronSecret = process.env.ACCOUNTING_CRON_SECRET;
const originalCronSecret = process.env.CRON_SECRET;

try {
  delete process.env.ACCOUNTING_CRON_SECRET;
  delete process.env.CRON_SECRET;
  process.env.WAVE_STATE_SIGNING_SECRET = "test-wave-state-secret";

  const now = Date.UTC(2026, 5, 24, 12, 0, 0);
  const state = createWaveOAuthState(now);
  assert.ok(state, "creates state when signing secret is present");
  assert.equal(
    verifyWaveOAuthState(state!, now + 1000),
    true,
    "verifies a valid signed state",
  );

  const parts = state!.split(".");
  const tampered = `${parts[0]}.${parts[1]}.deadbeef`;
  assert.equal(
    verifyWaveOAuthState(tampered, now + 1000),
    false,
    "rejects tampered signature",
  );

  assert.equal(
    verifyWaveOAuthState(state!, now + STATE_TTL_MS + 1),
    false,
    "rejects expired state",
  );
} finally {
  if (originalWaveStateSecret == null) {
    delete process.env.WAVE_STATE_SIGNING_SECRET;
  } else {
    process.env.WAVE_STATE_SIGNING_SECRET = originalWaveStateSecret;
  }

  if (originalAccountingCronSecret == null) {
    delete process.env.ACCOUNTING_CRON_SECRET;
  } else {
    process.env.ACCOUNTING_CRON_SECRET = originalAccountingCronSecret;
  }

  if (originalCronSecret == null) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
}

console.log("wave-oauth-state.test.ts: ok");
