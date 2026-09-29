// Pure state machine for OfflineSalesView's order list.
//
// Split out of ui.tsx (WAL-593) so the fetch/loading/error transitions can
// be reasoned about — and unit tested — without a React renderer. The
// effect in ui.tsx only ever dispatches from inside the async callback of
// `runGuardedLoad`, never synchronously in the effect body.
//
// That guard used to live here too. WAL-594 promoted it to
// @waltersignal/bananaforce-core, since nine effects across seven other
// modules needed the same thing and none should carry its own copy.
export interface SubmittedOrderRow {
  id: string;
  status: string;
  subtotal: number;
  created_at?: string;
  customer_email: string | null;
  business_name: string | null;
  item_count: number;
}

export interface OfflineSalesState {
  orders: SubmittedOrderRow[];
  loading: boolean;
  error: string | null;
}

export type OfflineSalesAction =
  | { type: "load-start" }
  | { type: "load-success"; orders: SubmittedOrderRow[] }
  | { type: "load-error"; message: string }
  | { type: "clear-error" };

export const initialOfflineSalesState: OfflineSalesState = {
  orders: [],
  loading: true,
  error: null,
};

export function offlineSalesReducer(
  state: OfflineSalesState,
  action: OfflineSalesAction,
): OfflineSalesState {
  switch (action.type) {
    case "load-start":
      return { ...state, loading: true, error: null };
    case "load-success":
      return { orders: action.orders, loading: false, error: null };
    case "load-error":
      return { ...state, loading: false, error: action.message };
    case "clear-error":
      return { ...state, error: null };
    default:
      return state;
  }
}
