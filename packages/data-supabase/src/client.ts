import { createBrowserClient } from "@supabase/ssr";

// createBrowserClient is meant to be called once and reused; a fresh client per
// call opens a new Realtime socket and duplicate auth listeners. Cache it.
let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    );
  }
  return browserClient;
}

// Env-only check, safe to import from client or server code. Guard data access
// with this before calling a client factory — the factories throw at
// construction when the Supabase env vars are unset.
export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
