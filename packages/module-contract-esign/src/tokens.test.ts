import assert from "node:assert/strict";

// Set the HMAC secret before importing the token module so isSignTokenConfigured
// is true under test. The module reads process.env.AUTH_SECRET at call time.
process.env.AUTH_SECRET = "test-secret-please-ignore";

const { createSignToken, verifySignToken, isSignTokenConfigured, signPageUrl, signPdfUrl } =
  await import("./tokens");
const { contractPdfFilename } = await import("./pdf");

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

const CONTRACT_ID = "11111111-2222-4333-8444-555555555555";

// --- configuration -------------------------------------------------------
check(isSignTokenConfigured() === true, "isSignTokenConfigured true when AUTH_SECRET set");

// --- round-trip ----------------------------------------------------------
const token = await createSignToken(CONTRACT_ID);
check(typeof token === "string" && token.split(".").length === 3, "createSignToken returns a JWT");

const verified = await verifySignToken(token);
check(verified?.contractId === CONTRACT_ID, "verifySignToken returns the contract id");

// --- rejects garbage / missing -------------------------------------------
check((await verifySignToken("not-a-token")) === null, "garbage token verifies to null");
check((await verifySignToken("")) === null, "empty token verifies to null");
check((await verifySignToken(null)) === null, "null token verifies to null");

// --- rejects a token signed with a different secret -----------------------
const goodSecret = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "a-different-secret";
const foreign = await createSignToken(CONTRACT_ID);
process.env.AUTH_SECRET = goodSecret;
check((await verifySignToken(foreign)) === null, "token from a different secret is rejected");

// --- rejects a wrong-purpose token (HS256, same secret, no contract-sign) -
const { SignJWT } = await import("jose");
const SIGN_ISSUER = "bananaforce-contract-esign";
const wrongPurpose = await new SignJWT({ purpose: "client-portal", contractId: CONTRACT_ID })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuer(SIGN_ISSUER)
  .setSubject(CONTRACT_ID)
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
check((await verifySignToken(wrongPurpose)) === null, "wrong-purpose token is rejected");

// --- rejects a wrong-issuer token (HS256, same secret, right purpose) -----
const wrongIssuer = await new SignJWT({ purpose: "contract-sign", contractId: CONTRACT_ID })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuer("some-other-service")
  .setSubject(CONTRACT_ID)
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
check((await verifySignToken(wrongIssuer)) === null, "wrong-issuer token is rejected");

// --- rejects an oversized token ------------------------------------------
const oversized = `${"a".repeat(2049)}`;
check((await verifySignToken(oversized)) === null, "oversized token is rejected");

// --- rejects an expired token --------------------------------------------
const expired = await new SignJWT({ purpose: "contract-sign", contractId: CONTRACT_ID })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuer(SIGN_ISSUER)
  .setSubject(CONTRACT_ID)
  .setIssuedAt(Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 40)
  .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
check((await verifySignToken(expired)) === null, "expired token is rejected");

// --- rejects a malformed contract id on mint -----------------------------
await assert.rejects(() => createSignToken("not-a-uuid"), "createSignToken rejects a non-UUID id");

// --- url helpers ---------------------------------------------------------
check(
  signPageUrl("abc", "https://example.com/") === "https://example.com/sign?token=abc",
  "signPageUrl strips a trailing slash and builds /sign",
);
check(
  signPdfUrl("a b", "https://example.com") === "https://example.com/api/sign?token=a%20b&pdf=1",
  "signPdfUrl url-encodes the token and adds pdf=1",
);

// --- contractPdfFilename (pure helper) -----------------------------------
check(
  contractPdfFilename("Acme, Inc.") === "Cleaning-Agreement-Acme-Inc.pdf",
  "contractPdfFilename slugs the company name",
);
check(
  contractPdfFilename(null) === "Cleaning-Agreement-client.pdf",
  "contractPdfFilename falls back to client",
);

console.log(`contract-esign token tests passed (${passed})`);
