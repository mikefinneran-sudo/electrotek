import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The service-role key BYPASSES Row Level Security. This module is the single
// place in the monorepo that reads SUPABASE_SERVICE_ROLE_KEY and constructs a
// service-role client. `import "server-only"` makes the bundler fail the build
// if this file is ever pulled into a client bundle, so the key can never leak
// to the browser. Callers that need privileged, staff-managed data access
// import getSupabaseServiceClient() from here instead of rolling their own.

/**
 * Env-only check (no I/O), safe to import anywhere a server module needs to
 * decide whether privileged data access is available.
 */
export function isServiceRoleConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

// Cache the client: a fresh client per call opens redundant connections.
let serviceClient: SupabaseClient | undefined;

/**
 * Returns a cached service-role Supabase client, or null when the env is not
 * configured (so callers can degrade to setup-required rather than throw).
 * Never expose the returned client or its key to client components.
 */
export function getSupabaseServiceClient(): SupabaseClient | null {
  if (!isServiceRoleConfigured()) return null;
  if (serviceClient) return serviceClient;

  serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return serviceClient;
}
