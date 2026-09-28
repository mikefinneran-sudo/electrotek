import "server-only";

import { getSupabaseServiceClient } from "./service";

export function warnSupabase(moduleLabel: string, operation: string, error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  console.warn(`${moduleLabel} ${operation} failed: ${message}`);
}

export function getServiceClientOrNull(moduleLabel: string, operation: string) {
  try {
    const client = getSupabaseServiceClient();
    if (!client) {
      console.warn(
        `${moduleLabel} ${operation} skipped: Supabase service-role client is not configured.`,
      );
    }
    return client;
  } catch (error) {
    warnSupabase(moduleLabel, operation, error);
    return null;
  }
}
