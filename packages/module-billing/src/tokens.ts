// Signed client pay-link tokens for the billing module. Mirrors
// module-client-portal/src/tokens.ts: self-contained jose HS256, purpose +
// issuer claims, UUID-validated id, length cap, sub cross-check, never throws.
//
// Prefer BILLING_TOKEN_SECRET; fall back to AUTH_SECRET. The purpose
// ("billing-pay") and issuer ("bananaforce-billing") differ from other modules,
// so a portal or contract-esign token cannot pass verifyPayLinkToken.

import "server-only";
import { SignJWT, jwtVerify } from "jose";

const PAY_PURPOSE = "billing-pay";
const PAY_ISSUER = "bananaforce-billing";
const DEFAULT_TTL_DAYS = 30;

// Cap before any crypto — a legitimate HS256 JWT for a UUID + purpose claim is
// well under this bound. Exported so the route layer imports a single source.
export const MAX_TOKEN_LENGTH = 2048;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Env-only check (no I/O). Token ops degrade to setup-required when false rather
 * than throwing.
 */
export function isBillingTokenConfigured(): boolean {
  return Boolean(process.env.BILLING_TOKEN_SECRET || process.env.AUTH_SECRET);
}

function secretKey(): Uint8Array {
  const secret = process.env.BILLING_TOKEN_SECRET || process.env.AUTH_SECRET;
  // Generic message — never name the env var in user-facing strings.
  if (!secret) throw new Error("Billing pay-link secret is not configured.");
  return new TextEncoder().encode(secret);
}

function safeInvoiceId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!UUID_RE.test(id)) throw new Error("Invalid invoice id.");
  return id;
}

/**
 * Mint a signed billing pay-link token for an invoice. Throws if the secret is
 * missing (guard with isBillingTokenConfigured) or the id is malformed.
 */
export async function createPayLinkToken(
  invoiceId: string,
  options: { ttlDays?: number } = {},
): Promise<string> {
  const id = safeInvoiceId(invoiceId);
  const ttlDays = options.ttlDays ?? DEFAULT_TTL_DAYS;
  return new SignJWT({ purpose: PAY_PURPOSE, invoiceId: id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(PAY_ISSUER)
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime(`${ttlDays}d`)
    .sign(secretKey());
}

/**
 * Verify a billing pay-link token. Returns { invoiceId } on success, or null
 * when the token is missing, oversized, expired, wrong-alg, wrong-purpose,
 * wrong-issuer, malformed, or the secret is absent. Never throws.
 */
export async function verifyPayLinkToken(
  token: string | null | undefined,
): Promise<{ invoiceId: string } | null> {
  if (!token) return null;
  if (token.length > MAX_TOKEN_LENGTH) return null;
  if (!isBillingTokenConfigured()) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: PAY_ISSUER,
      algorithms: ["HS256"],
    });
    if (payload.purpose !== PAY_PURPOSE) return null;
    const invoiceId = safeInvoiceId(payload.invoiceId);
    // Sub cross-check: a legitimate pay-link token sets sub === invoiceId.
    if (invoiceId !== String(payload.sub ?? "")) return null;
    return { invoiceId };
  } catch {
    return null;
  }
}
