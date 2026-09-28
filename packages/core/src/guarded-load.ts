/**
 * Stale-response guard for effects that fetch on a changing dependency.
 *
 * Promoted to core in WAL-594. It began life in module-ordering (WAL-593)
 * and is deliberately generic — no React import, no module-specific types —
 * so every module can share one implementation instead of each growing its
 * own `cancelled` flag. Nine effects across seven modules had no guard at
 * all when this moved here, while module-accounting's PendingOutboxPanel
 * had a correct hand-rolled one a hundred lines from a panel that did not.
 * That drift is the reason this lives in one place now.
 */

/**
 * Kicks off `load()` and routes its outcome to `onSuccess`/`onError`,
 * discarding the result if the returned cleanup function has already run.
 *
 * The return value is an effect cleanup function. Wire it up as:
 *
 * ```ts
 * useEffect(() => {
 *   dispatch({ type: "load-start" });
 *   return runGuardedLoad(
 *     () => fetchThings(filter),
 *     (things) => dispatch({ type: "load-success", things }),
 *     (message) => dispatch({ type: "load-error", message }),
 *     "Could not load things.",
 *   );
 * }, [filter]);
 * ```
 *
 * When `filter` changes, React runs the cleanup before the next effect, so
 * the in-flight request is marked stale and its response — however late it
 * arrives — cannot overwrite the newer one. Callbacks only ever fire from
 * inside the async body, never synchronously during the effect, which is
 * also what keeps `react-hooks/set-state-in-effect` quiet.
 *
 * `fallbackMessage` is used when the rejection is not an `Error` and so
 * carries no usable `.message`.
 */
export function runGuardedLoad<T>(
  load: () => Promise<T>,
  onSuccess: (result: T) => void,
  onError: (message: string) => void,
  fallbackMessage: string,
): () => void {
  let cancelled = false;
  void (async () => {
    try {
      const result = await load();
      if (!cancelled) onSuccess(result);
    } catch (err) {
      if (!cancelled) onError(err instanceof Error ? err.message : fallbackMessage);
    }
  })();
  return () => {
    cancelled = true;
  };
}
