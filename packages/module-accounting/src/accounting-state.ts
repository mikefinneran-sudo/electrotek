// Pure state machines for the two fetch-driven panels in ui.tsx
// (PendingOutboxPanel, AccountMapPanel). Split out (WAL-593) so the
// loading/error transitions can be reasoned about — and unit tested —
// without a React renderer, mirroring module-ordering's
// offline-sales-state.ts.
//
// Both panels dispatch from a `useReducer` instead of calling separate
// `useState` setters synchronously in an effect body — that synchronous
// call is what `react-hooks/set-state-in-effect` flags. A `dispatch` call
// in the same spot does not trip the rule.
import type { LedgerAccountMap, LedgerOutboxEvent } from "./types";

// --- PendingOutboxPanel -----------------------------------------------------

export interface PendingOutboxState {
  events: LedgerOutboxEvent[];
  loading: boolean;
  error: string | null;
}

export type PendingOutboxAction =
  | { type: "load-start" }
  | { type: "load-success"; events: LedgerOutboxEvent[] }
  | { type: "load-error"; message: string };

export const initialPendingOutboxState: PendingOutboxState = {
  events: [],
  loading: true,
  error: null,
};

export function pendingOutboxReducer(
  state: PendingOutboxState,
  action: PendingOutboxAction,
): PendingOutboxState {
  switch (action.type) {
    case "load-start":
      return { ...state, loading: true, error: null };
    case "load-success":
      return { events: action.events, loading: false, error: null };
    case "load-error":
      return { events: [], loading: false, error: action.message };
    default:
      return state;
  }
}

// --- AccountMapPanel ---------------------------------------------------------

export interface AccountMapState {
  rows: LedgerAccountMap[];
  error: string | null;
}

export type AccountMapAction =
  | { type: "load-clear" }
  | { type: "load-success"; rows: LedgerAccountMap[] }
  | { type: "load-error"; message: string };

export const initialAccountMapState: AccountMapState = {
  rows: [],
  error: null,
};

export function accountMapReducer(state: AccountMapState, action: AccountMapAction): AccountMapState {
  switch (action.type) {
    case "load-clear":
      return { ...state, error: null };
    case "load-success":
      return { rows: action.rows, error: null };
    case "load-error":
      return { ...state, error: action.message };
    default:
      return state;
  }
}
