// Signed sign-tokens for the client-facing /sign link (no client login). Ported
// from always-be-cleaning lib/sign-token.mjs. An HS256 JWT carries the contract
// id + a fixed purpose, with a ~30-day expiry. The token is the ONLY gate on the
// client sign route (createSignRouteHandlers), so it is verified server-side on
// every request and the purpose + id shape are both checked.
//
// No `server-only` import here on purpose: this module is also a fine place for
// the route layer to mint links, and jose runs in any server runtime. The HMAC
// secret is read from env at call time and never returned to a caller.

import "server-only";
import { SignJWT, jwtVerify } from "jose";

const SIGN_PURPOSE = "contract-sign";
const SIGN_ISSUER = "bananaforce-contract-esign";
const DEFAULT_SIGN_TTL_DAYS = 30;

// The contracts PK is a v4 UUID (gen_random_uuid()). Validate the shape on both
// mint and verify so a malformed/spoofed subject can never reach the DB layer.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Env-only check (no I/O), safe to import anywhere. Token minting/verification
 * needs an HMAC secret; without it the sign flow degrades to setup-required
 * rather than throwing. Kept distinct from the Supabase service-role check so a
 * site can be missing one without masking the other.
 */
export function isSignTokenConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET);
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  // Generic message — never name the env var in anything user-facing. This
  // throws only on the server when a token operation is attempted unconfigured;
  // callers guard with isSignTokenConfigured() and degrade gracefully.
  if (!secret) throw new Error("Sign-token secret is not configured.");
  return new TextEncoder().encode(secret);
}

function safeContractId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!UUID_RE.test(id)) throw new Error("Invalid contract id.");
  return id;
}

/**
 * Mint a signed sign-token for a contract. Throws if the secret is missing
 * (guard with isSignTokenConfigured) or the id is malformed.
 */
export async function createSignToken(
  contractId: string,
  options: { ttlDays?: number } = {},
): Promise<string> {
  const id = safeContractId(contractId);
  const ttlDays = options.ttlDays ?? DEFAULT_SIGN_TTL_DAYS;
  return new SignJWT({ purpose: SIGN_PURPOSE, contractId: id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SIGN_ISSUER)
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime(`${ttlDays}d`)
    .sign(secretKey());
}

/**
 * Verify a sign-token. Returns the contract id on success, or null when the
 * token is missing, expired, wrong-purpose, malformed, or the secret is absent.
 * Never throws — the route layer turns null into a 401/410-style response.
 */
export async function verifySignToken(
  token: string | null | undefined,
): Promise<{ contractId: string } | null> {
  if (!token) return null;
  if (!isSignTokenConfigured()) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: SIGN_ISSUER,
      algorithms: ["HS256"],
    });
    if (payload.purpose !== SIGN_PURPOSE) return null;
    const contractId = safeContractId(payload.contractId);
    return { contractId };
  } catch {
    return null;
  }
}

/** Build the client-facing sign-page URL for a token. */
export function signPageUrl(token: string, origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/sign?token=${encodeURIComponent(token)}`;
}

/** Build the executed-PDF URL for a signed contract token. */
export function signPdfUrl(token: string, origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/api/sign?token=${encodeURIComponent(token)}&pdf=1`;
}
