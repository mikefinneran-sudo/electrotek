// Pure result-resolution for the crew portal's on-demand tabs (WAL-594).
//
// LeadsTab and ClientDetailTab both fetch a JSON envelope shaped
// `{ ok, <key>, error }` (see `getJson` in ui.tsx) and need to turn that
// into either a value or an error message. Pulling that mapping out here
// lets it be tested without a React renderer, and lets it be wired
// directly into `runGuardedLoad` (@waltersignal/bananaforce-core) the same
// way ui.tsx does — the guard calls this from its `onSuccess` callback,
// which only ever fires from inside the async body, never synchronously
// during the effect.
export interface ApiResult {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export type ResolvedApiResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function resolveApiResult<T>(
  result: ApiResult,
  key: string,
  defaultValue: T,
  fallbackMessage: string,
): ResolvedApiResult<T> {
  if (!result.ok) {
    return { ok: false, message: result.error ?? fallbackMessage };
  }
  const value = result[key];
  return { ok: true, value: (value as T | undefined) ?? defaultValue };
}

// Pure state machine for LeadsTab's list (WAL-593). Collapses `leads` +
// `loading` into one reducer so the effect that reloads on `statusFilter`
// only ever dispatches from inside runGuardedLoad's callbacks, never
// synchronously in the effect body — the same shape module-ordering's
// offline-sales-state.ts and module-ticketing's ticketing-load.ts use.
//
// `Lead` itself lives in ./types, which this file deliberately does not
// import (kept generic-free like the rest of this module's pure logic) —
// ui.tsx supplies the type parameter at the call site.
export interface LeadsListState<Lead> {
  leads: Lead[];
  loading: boolean;
}

export type LeadsListAction<Lead> =
  | { type: "load-start" }
  | { type: "load-success"; leads: Lead[] }
  | { type: "load-done" }
  | { type: "lead-updated"; lead: Lead };

export function initialLeadsListState<Lead>(): LeadsListState<Lead> {
  return { leads: [], loading: true };
}

// Pure state machine for ClientDetailTab's `detail` + `loading` (WAL-593).
// Same reasoning as LeadsListState above: collapsing the two useState calls
// into one reducer lets the effect's `setLoading(true)` become a dispatch
// from inside runGuardedLoad's callbacks. Kept generic (like
// LeadsListState) so this file stays free of module-specific type imports;
// ui.tsx supplies `ClientDetail` at the call site. `load-success` doubles
// as the action `changeStatus` uses to write back an updated inspection —
// it is exactly "set detail to this value, loading is already false."
export interface ClientDetailState<Detail> {
  detail: Detail | null;
  loading: boolean;
}

export type ClientDetailAction<Detail> =
  | { type: "load-start" }
  | { type: "load-success"; detail: Detail | null }
  | { type: "load-error" };

export function initialClientDetailState<Detail>(): ClientDetailState<Detail> {
  return { detail: null, loading: false };
}

export function clientDetailReducer<Detail>(
  state: ClientDetailState<Detail>,
  action: ClientDetailAction<Detail>,
): ClientDetailState<Detail> {
  switch (action.type) {
    case "load-start":
      return { ...state, loading: true };
    case "load-success":
      return { detail: action.detail, loading: false };
    case "load-error":
      return { detail: null, loading: false };
    default:
      return state;
  }
}

export function leadsListReducer<Lead extends { id: string }>(
  state: LeadsListState<Lead>,
  action: LeadsListAction<Lead>,
): LeadsListState<Lead> {
  switch (action.type) {
    case "load-start":
      return { ...state, loading: true };
    case "load-success":
      return { leads: action.leads, loading: false };
    case "load-done":
      return { ...state, loading: false };
    case "lead-updated":
      return {
        ...state,
        leads: state.leads.map((lead) => (lead.id === action.lead.id ? action.lead : lead)),
      };
    default:
      return state;
  }
}
