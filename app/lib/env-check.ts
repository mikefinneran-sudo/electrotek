import clientConfig from "../client.config";

// Modules that need no backend. Everything else requires Supabase.
const NO_BACKEND = new Set(["marketing-site"]);

/**
 * Validate that required env vars are present for the modules this client has
 * enabled. In dev/demo this only warns (graceful degradation is intentional);
 * in a real production deploy it throws so a misconfiguration fails fast instead
 * of silently serving a broken product.
 */
export function assertEnv(): void {
  const problems: string[] = [];

  const needsSupabase = clientConfig.modules.some((m) => !NO_BACKEND.has(m));
  if (needsSupabase) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) problems.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (clientConfig.modules.includes("billing") && !process.env.STRIPE_SECRET_KEY) {
    problems.push("STRIPE_SECRET_KEY (billing enabled)");
  }

  if (problems.length === 0) return;

  const message = `[BananaFORCE] Missing required env vars for enabled modules: ${problems.join(", ")}`;
  const isProd =
    process.env.NODE_ENV === "production" && process.env.BANANAFORCE_DEMO_OPEN_API !== "1";
  if (isProd) throw new Error(message);
  console.error(message);
}
