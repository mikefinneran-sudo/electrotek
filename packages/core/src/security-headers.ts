/**
 * Nonce-based CSP for Next App Router.
 *
 * Next injects inline <script> tags carrying the RSC payload. A CSP whose
 * script-src is just 'self' blocks every one of them, so React never hydrates:
 * pages render correctly from the server and then nothing is interactive --
 * buttons do nothing, with no console-visible failure beyond the CSP report.
 * apps/electrotek and apps/waltersignal both shipped that way.
 *
 * The fix is a per-request nonce rather than 'unsafe-inline'. Next reads the
 * nonce off the CSP header on the request and stamps it onto the scripts it
 * generates, so the inline payload is allowed while genuinely injected inline
 * script still is not.
 *
 * This must be the ONLY source of CSP for the app: a second CSP header (e.g.
 * from vercel.json) is intersected with this one, and its script-src 'self'
 * would re-block the very scripts this nonce allows.
 */
export function buildCsp(nonce: string, supabaseOrigin: string | null = null): string {
  // The project's own origin, for a Supabase not on *.supabase.co (a custom
  // domain, or the local stack at 127.0.0.1). Without it, signed receipt images
  // from Storage render as broken images there.
  const supabase =
    supabaseOrigin && !supabaseOrigin.endsWith(".supabase.co") ? ` ${supabaseOrigin}` : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    // 'strict-dynamic' lets the nonced bootstrap load Next's own chunks.
    // Browsers that honour it ignore the host allowlist that follows, which is
    // kept for those that do not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cdn.jsdelivr.net https://js.stripe.com`,
    // Next and styled-jsx emit inline styles with no nonce; there is no nonce
    // path for them, and inline CSS is not a script-execution vector.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://*.supabase.co${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${supabase} https://api.stripe.com https://js.stripe.com https://checkout.stripe.com`,
    "frame-src https://js.stripe.com https://checkout.stripe.com",
    "worker-src 'self' blob:",
    "form-action 'self'",
  ].join("; ");
}

export const STATIC_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Frame-Options", "DENY"],
  ["Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
];

// Scheme + host[:port]. A regex, not URL: this package has no DOM or node lib.
function originOf(url: string | undefined): string | null {
  return url?.match(/^https?:\/\/[^/\s;'"]+/)?.[0] ?? null;
}

/**
 * Apply CSP + static headers to a middleware response.
 *
 * The nonce goes on the REQUEST headers too: that is how Next picks it up and
 * stamps its generated script tags.
 */
type HeaderBag = { headers: { set(name: string, value: string): void } };

export function applySecurityHeaders<Res extends HeaderBag>(
  request: HeaderBag,
  response: Res,
): Res {
  // No DOM or node lib in this package's tsconfig, so reach the runtime globals
  // through unknown. Both exist in the edge runtime and in Node 19+.
  const { crypto: runtimeCrypto, btoa: runtimeBtoa, process: runtimeProcess } =
    globalThis as unknown as {
      crypto: { randomUUID(): string };
      btoa(data: string): string;
      process?: { env: Record<string, string | undefined> };
    };
  const nonce = runtimeBtoa(runtimeCrypto.randomUUID()).replace(/=+$/, "");
  const csp = buildCsp(nonce, originOf(runtimeProcess?.env.NEXT_PUBLIC_SUPABASE_URL));

  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);

  response.headers.set("content-security-policy", csp);
  for (const [key, value] of STATIC_SECURITY_HEADERS) response.headers.set(key, value);
  return response;
}
