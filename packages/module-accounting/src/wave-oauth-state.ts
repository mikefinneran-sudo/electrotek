// HMAC-signed Wave OAuth state parameter (CSRF protection).

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

function signingSecret(): string | null {
  return process.env.WAVE_STATE_SIGNING_SECRET?.trim() || null;
}

function stateSignature(
  nonce: string,
  expiryMs: number,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${nonce}.${expiryMs}`, "utf8")
    .digest("hex");
}

/**
 * Create a signed OAuth state value: `{nonce}.{expiryMs}.{signature}`.
 */
export function createWaveOAuthState(nowMs: number = Date.now()): string | null {
  const secret = signingSecret();
  if (!secret) return null;

  const nonce = randomUUID();
  const expiryMs = nowMs + STATE_TTL_MS;
  const sig = stateSignature(nonce, expiryMs, secret);
  return `${nonce}.${expiryMs}.${sig}`;
}

/** Verify signature and expiry. */
export function verifyWaveOAuthState(
  state: string,
  nowMs: number = Date.now(),
): boolean {
  const secret = signingSecret();
  if (!secret) return false;

  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expiryRaw, signature] = parts;
  if (!nonce || !expiryRaw || !signature) return false;

  const expiryMs = Number(expiryRaw);
  if (!Number.isFinite(expiryMs)) return false;
  if (nowMs > expiryMs) return false;

  const expectedSignature = stateSignature(nonce, expiryMs, secret);
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const providedBuffer = Buffer.from(signature, "hex");
  if (
    expectedBuffer.length === 0 ||
    providedBuffer.length === 0 ||
    expectedBuffer.length !== providedBuffer.length
  ) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export { STATE_TTL_MS };
