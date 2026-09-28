export const TURNSTILE_SECRET_ENV = "TURNSTILE_SECRET_KEY";
export const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerificationResult {
  ok: boolean;
  skipped: boolean;
  errorCodes?: string[];
}

interface TurnstileVerifyOptions {
  secret?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Verify a Cloudflare Turnstile token when the secret is configured.
 *
 * An absent secret preserves today's behavior. Once configured, every failure
 * mode is closed: missing tokens, non-2xx responses, malformed responses, and
 * network errors all reject the submission.
 */
export async function verifyTurnstile(
  token: string,
  remoteIp?: string,
  options: TurnstileVerifyOptions = {},
): Promise<TurnstileVerificationResult> {
  const secret = options.secret ?? process.env[TURNSTILE_SECRET_ENV];
  if (!secret) return { ok: true, skipped: true };
  if (!token.trim()) {
    return { ok: false, skipped: false, errorCodes: ["missing-input-response"] };
  }

  const body = new URLSearchParams({ secret, response: token.trim() });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await (options.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, skipped: false };

    const result = (await response.json().catch(() => null)) as {
      success?: unknown;
      "error-codes"?: unknown;
    } | null;
    const errorCodes = Array.isArray(result?.["error-codes"])
      ? result["error-codes"].filter((code): code is string => typeof code === "string")
      : undefined;

    return {
      ok: result?.success === true,
      skipped: false,
      ...(errorCodes && errorCodes.length > 0 ? { errorCodes } : {}),
    };
  } catch {
    return { ok: false, skipped: false };
  }
}
