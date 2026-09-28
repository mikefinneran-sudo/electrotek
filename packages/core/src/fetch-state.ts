/**
 * Generic fetch-lifecycle state machine.
 *
 * Promoted to core in WAL-593. Two modules independently grew a byte-identical
 * copy of this reducer in the same change — the same drift that produced two
 * copies of `demo-nav.ts` (WAL-591) and would have produced three copies of
 * `runGuardedLoad` (WAL-594). Nothing here is module-specific, so there is no
 * reason for a second implementation to exist.
 *
 * Pairs with `runGuardedLoad`: dispatch `load-start` in the effect body, then
 * return `runGuardedLoad(...)` dispatching `load-success` / `load-error` from
 * its async callbacks. A `dispatch` in the effect body does not trip
 * `react-hooks/set-state-in-effect`, where a bare `useState` setter does.
 */
export type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "error"; message: string };

export type FetchAction<T> =
  | { type: "reset" }
  | { type: "load-start" }
  | { type: "load-success"; data: T }
  | { type: "load-error"; message: string };

export function initialFetchState<T>(): FetchState<T> {
  return { status: "idle" };
}

export function fetchStateReducer<T>(
  state: FetchState<T>,
  action: FetchAction<T>,
): FetchState<T> {
  switch (action.type) {
    case "reset":
      return { status: "idle" };
    case "load-start":
      return { status: "loading" };
    case "load-success":
      return { status: "loaded", data: action.data };
    case "load-error":
      return { status: "error", message: action.message };
    default: {
      // Deliberately NOT `return state`. Assigning to `never` makes adding a
      // member to FetchAction a compile error until it is handled here, rather
      // than something that silently falls through to the previous state.
      // WAL-598 exists because a `default` clause elsewhere in this repo made
      // a new event type look handled while filing expenses as revenue.
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
