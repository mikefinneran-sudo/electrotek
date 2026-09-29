// Reset ledger_outbox rows stuck in `processing` after a crash mid-drain.
// DB work lives here; pure helpers are safe to import from tests.

/** Default: 15 minutes — matches stale sync run reaper in server.ts. */
export const DEFAULT_STUCK_OUTBOX_MS = 15 * 60 * 1000;

/**
 * PostgREST `or` filter matching `processing` rows whose claim is stale.
 * A row with no claimed_at was claimed by code older than migration 0064; it
 * counts as stale only once created_at is past the cutoff too, so a worker
 * mid-push during that deploy is not reset under it.
 * Pure helper for tests.
 */
export function staleClaimFilter(cutoffIso: string): string {
  return `claimed_at.lt.${cutoffIso},and(claimed_at.is.null,created_at.lt.${cutoffIso})`;
}

/**
 * Reset stuck `processing` outbox events to `pending`.
 * @returns count of rows reset
 */
export async function reapStuckOutboxEvents(
  maxAgeMs: number = DEFAULT_STUCK_OUTBOX_MS,
): Promise<number> {
  const supabase = await (async () => {
    try {
      const { getSupabaseServiceClient } = await import(
        "@waltersignal/bananaforce-data-supabase/service"
      );
      return getSupabaseServiceClient();
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message)
          : String(error);
      console.warn(`Accounting reapStuckOutboxEvents failed: ${message}`);
      return null;
    }
  })();
  if (!supabase) return 0;

  // One statement carries its own staleness predicate. Deciding staleness from
  // an earlier read and resetting by id let a second drain reset a row that
  // the first had already re-claimed (C-02 class).
  const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();
  const { data: resetRows, error: resetError } = await supabase
    .from("ledger_outbox")
    .update({
      status: "pending",
      claimed_at: null,
      processed_at: null,
    })
    .eq("status", "processing")
    .or(staleClaimFilter(cutoffIso))
    .select("id");

  if (resetError) {
    console.warn(`Accounting reapStuckOutboxEvents failed: ${resetError.message}`);
    return 0;
  }

  return (resetRows ?? []).length;
}
