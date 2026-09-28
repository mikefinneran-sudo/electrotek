import { assertEnv } from "./lib/env-check";

// Next.js boot hook — runs once when the server starts. Fail fast (in prod) on a
// misconfigured deploy instead of silently degrading at request time.
export function register(): void {
  assertEnv();
}
