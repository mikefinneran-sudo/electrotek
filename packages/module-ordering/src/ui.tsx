"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useReducer, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@waltersignal/bananaforce-data-supabase/client";
import { formatPrice, tierLabel } from "@waltersignal/bananaforce-module-catalog/pricing";
import type { Order, OrderAccount, OrderStatus } from "./index";
import { runGuardedLoad } from "@waltersignal/bananaforce-core";
import {
  initialOfflineSalesState,
  offlineSalesReducer,
  type SubmittedOrderRow,
} from "./offline-sales-state";

const mutedStyle: CSSProperties = {
  color: "var(--muted)",
};

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

// The server actions return a result object; <form action> ignores the return
// value. We accept the result-returning shape here (keeping ui.tsx free of any
// server-only imports) and adapt it to React's void-returning form action.
type OrderFormAction = (formData: FormData) => unknown;

function asFormAction(action: OrderFormAction): (formData: FormData) => void {
  return (formData: FormData) => {
    void action(formData);
  };
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page">
      <main className="container" style={{ maxWidth: 760 }}>
        <header className="page-head">
          <h1>{title}</h1>
        </header>
        <div>{children}</div>
      </main>
    </div>
  );
}

export interface OrdersViewProps {
  order: Order | null;
  setupRequired?: boolean;
  authenticated?: boolean;
  removeItemAction: OrderFormAction;
  submitOrderAction: OrderFormAction;
}

export function OrdersView({
  order,
  setupRequired = false,
  authenticated = false,
  removeItemAction,
  submitOrderAction,
}: OrdersViewProps) {
  if (setupRequired) {
    return (
      <Shell title="Your order">
        <p className="callout">
          Ordering is not configured. Contact your administrator.
        </p>
      </Shell>
    );
  }

  if (!authenticated) {
    return (
      <Shell title="Your order">
        <p style={{ ...mutedStyle, margin: 0, lineHeight: 1.6 }}>
          Please{" "}
          <Link href="/account" className="inline-link">
            sign in
          </Link>{" "}
          to view your order.
        </p>
      </Shell>
    );
  }

  if (!order || order.items.length === 0) {
    return (
      <Shell title="Your order">
        <p style={{ ...mutedStyle, margin: 0, lineHeight: 1.6 }}>
          Your order is empty.{" "}
          <Link href="/catalog" className="inline-link">
            Browse the catalog
          </Link>
          .
        </p>
      </Shell>
    );
  }

  const submitted = order.status !== "cart";

  return (
    <Shell title={submitted ? "Order submitted" : "Your order"}>
      {submitted ? (
        <p className="callout success" style={{ marginBottom: "1.25rem" }}>
          Order #{order.id.slice(0, 8)} has been submitted to the store. Payment is settled in
          person at pickup.
        </p>
      ) : null}

      <div className="order-list">
        {order.items.map((item) => (
          <div key={item.id} className="order-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{item.product_name ?? "Item"}</div>
              <div style={{ ...mutedStyle, fontSize: "0.8125rem" }}>
                #{item.item_number ?? "—"} · {formatPrice(item.unit_price)} ea
              </div>
            </div>
            <div style={{ fontSize: "0.875rem" }}>×{item.qty}</div>
            <div style={{ width: 80, textAlign: "right", fontWeight: 600 }}>
              {formatPrice(item.line_total)}
            </div>
            {!submitted ? (
              <form action={asFormAction(removeItemAction)}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="orderId" value={order.id} />
                <button type="submit" aria-label="Remove item" className="icon-btn">
                  ✕
                </button>
              </form>
            ) : null}
          </div>
        ))}
      </div>

      <div className="order-total">
        <span style={{ fontSize: "1.125rem", fontWeight: 600 }}>Subtotal</span>
        <span style={{ fontSize: "1.125rem", fontWeight: 700 }}>{formatPrice(order.subtotal)}</span>
      </div>

      {!submitted ? (
        <form action={asFormAction(submitOrderAction)} style={{ marginTop: "1.5rem" }}>
          <input type="hidden" name="orderId" value={order.id} />
          <button type="submit" className="btn">
            Submit order to store
          </button>
          <p style={{ ...mutedStyle, margin: "0.5rem 0 0", fontSize: "0.75rem" }}>
            No payment is taken online. The store confirms availability and settles payment at
            pickup.
          </p>
        </form>
      ) : null}
    </Shell>
  );
}

export interface AccountViewProps {
  account: OrderAccount | null;
  setupRequired?: boolean;
}

export function AccountView({ account, setupRequired = false }: AccountViewProps) {
  return (
    <Shell title="Account">
      {setupRequired ? (
        <p className="callout">
          Accounts are not configured. Contact your administrator.
        </p>
      ) : account ? (
        <div style={{ display: "grid", gap: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <SignOut />
          </div>
          <div className="panel pad">
            <dl className="detail-dl">
              <dt>Email</dt>
              <dd>{account.email ?? "—"}</dd>
              <dt>Business</dt>
              <dd>{account.business_name ?? "—"}</dd>
              <dt>Tier</dt>
              <dd>{tierLabel(account.tier)}</dd>
              <dt>Tax-exempt</dt>
              <dd>{account.tax_exempt ? "Yes" : "No"}</dd>
              <dt>Status</dt>
              <dd>{account.approved ? "Approved" : "Pending approval"}</dd>
            </dl>
          </div>
          <Link href="/orders" className="btn" style={{ width: "fit-content" }}>
            View my order
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1.5rem" }}>
          <section className="panel pad">
            <AuthForm />
          </section>
          <section className="panel pad">
            <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>Wholesale accounts</h2>
            <p style={{ ...mutedStyle, margin: "0.5rem 0 0", lineHeight: 1.5 }}>
              Wholesale buyers get tiered pricing once approved. New accounts start as retail and
              require staff approval before wholesale pricing is shown.
            </p>
          </section>
        </div>
      )}
    </Shell>
  );
}

export function AuthForm() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [business, setBusiness] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setPending(true);

    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { business_name: business || null } },
        });
        if (signUpError) throw signUpError;

        setMessage(
          "Account created. If email confirmation is on, check your inbox, then sign in.",
        );

        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.refresh();
          return;
        }
        setMode("signin");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="tabs">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={`tab${mode === "signin" ? " active" : ""}`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`tab${mode === "signup" ? " active" : ""}`}
        >
          Create account
        </button>
      </div>

      {mode === "signup" ? (
        <label className="field">
          <span className="label">Business name (optional)</span>
          <input
            className="input"
            value={business}
            onChange={(event) => setBusiness(event.target.value)}
          />
        </label>
      ) : null}

      <label className="field">
        <span className="label">Email</span>
        <input
          className="input"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="label">Password</span>
        <input
          className="input"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {error ? <p className="form-msg error">{error}</p> : null}
      {message ? <p className="form-msg success">{message}</p> : null}

      <button type="submit" disabled={pending} className="btn block">
        {pending ? "…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}

export function SignOut() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.refresh();
  }

  return (
    <button type="button" onClick={signOut} className="btn ghost">
      Sign out
    </button>
  );
}

export interface AddToCartPanelProps {
  productId: number;
  availability?: "in_stock" | "low_stock" | "out_of_stock";
  addToOrderAction: OrderFormAction;
}

/** Product-detail add-to-cart for offline-settlement ordering. */
export function AddToCartPanel({
  productId,
  availability = "in_stock",
  addToOrderAction,
}: AddToCartPanelProps) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outOfStock = availability === "out_of_stock";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const formData = new FormData(event.currentTarget);
      const result = (await addToOrderAction(formData)) as { ok?: boolean; error?: string; unauthorized?: boolean };
      if (result?.unauthorized) {
        router.push("/account");
        return;
      }
      if (!result?.ok) {
        setError(result?.error ?? "Could not add to order.");
        return;
      }
      router.push("/orders");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add to order.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel pad" style={{ display: "grid", gap: "0.75rem", maxWidth: 420 }}>
      <span className="eyebrow">Offline sales</span>
      {error ? (
        <p role="alert" className="form-msg error">
          {error}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="form">
        <input type="hidden" name="productId" value={productId} />
        <label className="field">
          <span className="label">Quantity</span>
          <input
            className="input"
            type="number"
            name="qty"
            min={1}
            step={1}
            required
            value={qty}
            onChange={(event) => setQty(Math.max(1, Number(event.target.value) || 1))}
            disabled={pending || outOfStock}
          />
        </label>
        <button type="submit" className="btn block" disabled={pending || outOfStock}>
          {pending ? "Adding…" : outOfStock ? "Out of stock" : "Add to order"}
        </button>
      </form>
      <p style={{ ...mutedStyle, margin: 0, fontSize: "0.8125rem", lineHeight: 1.5 }}>
        No payment online. Submit the order from{" "}
        <Link href="/orders" className="inline-link">
          your cart
        </Link>{" "}
        and pay at pickup or counter.
      </p>
    </div>
  );
}

export type { SubmittedOrderRow };

export interface OfflineSalesViewProps {
  endpoint?: string;
  title?: string;
  setupRequired?: boolean;
}

const STATUS_FILTERS: OrderStatus[] = ["submitted", "confirmed", "fulfilled", "cancelled"];

export function OfflineSalesView({
  endpoint = "/api/orders",
  title = "Offline sales",
  setupRequired = false,
}: OfflineSalesViewProps) {
  const [state, dispatch] = useReducer(offlineSalesReducer, initialOfflineSalesState);
  const { orders, loading, error } = state;
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrderStatus>("submitted");

  // Fetches the current page of orders and returns it — it does not set
  // state itself, so every caller (the auto-load effect below, `mutate`,
  // and the manual Refresh button) decides how to route the result.
  const reload = useCallback(async () => {
    const res = await fetch(`${endpoint}?entity=orders&status=${statusFilter}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Could not load orders (${res.status}).`);
    const data = (await res.json().catch(() => ({}))) as { orders?: SubmittedOrderRow[] };
    return data.orders ?? [];
  }, [endpoint, statusFilter]);

  useEffect(() => {
    // Nothing in `state` is read while setup is required — see the early
    // return below, which renders a callout instead of this view's body —
    // so there is nothing to reset here. WAL-593.
    if (setupRequired) return;
    dispatch({ type: "load-start" });
    return runGuardedLoad(
      reload,
      (loadedOrders) => dispatch({ type: "load-success", orders: loadedOrders }),
      (message) => dispatch({ type: "load-error", message }),
      "Could not load orders.",
    );
  }, [reload, setupRequired]);

  const mutate = useCallback(
    async (orderId: string, newStatus: string): Promise<void> => {
      setBusy(true);
      dispatch({ type: "clear-error" });
      try {
        const res = await fetch(endpoint, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ id: orderId, status: newStatus }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `Request failed (${res.status}).`);
        }
        const loadedOrders = await reload();
        dispatch({ type: "load-success", orders: loadedOrders });
      } catch (err) {
        dispatch({ type: "load-error", message: err instanceof Error ? err.message : "Action failed." });
      } finally {
        setBusy(false);
      }
    },
    [endpoint, reload],
  );

  if (setupRequired) {
    return (
      <Shell title={title}>
        <p className="callout">
          Offline sales queue is not configured. Contact your administrator.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title={title}>
      <p style={{ ...mutedStyle, margin: "0 0 1rem", lineHeight: 1.6 }}>
        Staff order management — confirm, fulfill, or cancel submitted orders.
      </p>

      {/* Status filter */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            className={`btn${statusFilter === s ? "" : " ghost"}`}
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            dispatch({ type: "clear-error" });
            void reload()
              .then((loadedOrders) => dispatch({ type: "load-success", orders: loadedOrders }))
              .catch((err) =>
                dispatch({
                  type: "load-error",
                  message: err instanceof Error ? err.message : "Could not refresh.",
                }),
              );
          }}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p role="alert" className="form-msg error">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="price-note">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="price-note">No {statusFilter} orders.</p>
      ) : (
        <div className="order-list">
          {orders.map((order) => (
            <div key={order.id} className="order-row">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Order #{order.id.slice(0, 8)}</div>
                <div style={{ ...mutedStyle, fontSize: "0.8125rem" }}>
                  {order.business_name ?? order.customer_email ?? "Customer"} · {order.item_count}{" "}
                  item{order.item_count === 1 ? "" : "s"}
                  {order.created_at ? ` · ${formatDate(order.created_at)}` : ""}
                </div>
              </div>
              <div style={{ fontWeight: 600 }}>{formatPrice(order.subtotal)}</div>
              <span className="badge in-stock">{order.status}</span>
              {/* Per-row action buttons */}
              {order.status === "submitted" ? (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void mutate(order.id, "confirmed")}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void mutate(order.id, "cancelled")}
                  >
                    Cancel
                  </button>
                </div>
              ) : order.status === "confirmed" ? (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void mutate(order.id, "fulfilled")}
                  >
                    Fulfill
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void mutate(order.id, "cancelled")}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
