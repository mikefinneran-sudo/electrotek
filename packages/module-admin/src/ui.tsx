"use client";

// Staff admin dashboard. A single client component with five tabs over the
// commerce data: Catalog, Pricing, Approvals, Inventory, Orders. Initial data is
// server-rendered by createAdminPage (service-role reads) and passed in as
// props; mutations and refetches go through the gated /api/admin endpoint.
//
// UX feel borrows from always-be-cleaning's multiplexed staff dashboard
// (crew.html / /api/crew) — a tab switcher over one operational surface — but
// the data here is COMMERCE (catalog/ordering), not the service vertical.
//
// Reuses the shared globals.css classes (panel, form, input, badge, order-row,
// tabs, detail-dl, etc.) so it matches the rest of the deploy stack.

import { useCallback, useMemo, useState } from "react";
import type {
  AdminProduct,
  Category,
  Customer,
  CustomerTier,
  Location,
  Order,
  OrderStatus,
  ProductInventory,
  Vendor,
} from "./types";
import { ADMIN_ORDER_TRANSITIONS } from "./types";

const ENDPOINT = "/api/admin";

const TABS = [
  { id: "catalog", label: "Catalog" },
  { id: "pricing", label: "Pricing" },
  { id: "approvals", label: "Approvals" },
  { id: "inventory", label: "Inventory" },
  { id: "orders", label: "Orders" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TIER_OPTIONS: readonly { value: CustomerTier; label: string }[] = [
  { value: "retail", label: "Retail" },
  { value: "wholesale_taxed", label: "Wholesale (taxed)" },
  { value: "wholesale_exempt", label: "Wholesale (tax-exempt)" },
];

export interface AdminDashboardProps {
  title?: string;
  setupRequired?: boolean;
  notAuthorized?: boolean;
  products: AdminProduct[];
  customers: Customer[];
  inventory: ProductInventory[];
  orders: Order[];
  categories: Category[];
  vendors: Vendor[];
  locations: Location[];
}

function formatUsd(value: number | null | undefined, fallback = "—"): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function statusBadgeClass(status: OrderStatus): string {
  switch (status) {
    case "fulfilled":
      return "badge in-stock";
    case "cancelled":
      return "badge out-stock";
    case "confirmed":
    case "submitted":
      return "badge low-stock";
    default:
      return "badge";
  }
}

type ApiResult = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

async function postAction(payload: Record<string, unknown>): Promise<ApiResult> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => ({}))) as ApiResult;
    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error ?? "Request failed." };
    }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Request failed." };
  }
}

function useFlash() {
  const [flash, setFlash] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const show = useCallback((kind: "success" | "error", text: string) => {
    setFlash({ kind, text });
  }, []);
  return { flash, show, clear: () => setFlash(null) };
}

function Flash({ flash }: { flash: { kind: "success" | "error"; text: string } | null }) {
  if (!flash) return null;
  return (
    <p className={`form-msg ${flash.kind === "error" ? "error" : "success"}`} role="status">
      {flash.text}
    </p>
  );
}

// --- Catalog tab ---------------------------------------------------------

function CatalogTab({
  initial,
  categories,
  vendors,
}: {
  initial: AdminProduct[];
  categories: Category[];
  vendors: Vendor[];
}) {
  const [products, setProducts] = useState(initial);
  const [savingId, setSavingId] = useState<number | null>(null);
  const { flash, show } = useFlash();

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const vendorName = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors]);

  async function onSave(product: AdminProduct, form: HTMLFormElement) {
    setSavingId(product.id);
    const data = new FormData(form);
    const result = await postAction({
      action: "updateProduct",
      id: product.id,
      name: data.get("name"),
      retail_price: data.get("retail_price"),
      category_id: data.get("category_id"),
      vendor_id: data.get("vendor_id"),
      is_active: data.get("is_active") === "on",
      wholesale_excluded: data.get("wholesale_excluded") === "on",
    });
    setSavingId(null);
    if (!result.ok) {
      show("error", result.error ?? "Could not save.");
      return;
    }
    const updated = result.product as AdminProduct | undefined;
    if (updated) {
      setProducts((prev) =>
        prev.map((p) => (p.id === updated.id ? { ...updated, wholesale_price: p.wholesale_price } : p)),
      );
    }
    show("success", "Product saved.");
  }

  return (
    <div className="form">
      <Flash flash={flash} />
      {products.length === 0 ? (
        <div className="empty">
          <h2>No products</h2>
          <p>Products from the catalog will appear here once the catalog is seeded.</p>
        </div>
      ) : (
        <div className="order-list">
          {products.map((product) => (
            <form
              key={product.id}
              className="order-row"
              style={{ flexWrap: "wrap", gap: "0.75rem" }}
              onSubmit={(e) => {
                e.preventDefault();
                void onSave(product, e.currentTarget);
              }}
            >
              <div style={{ flexBasis: "100%", display: "flex", justifyContent: "space-between" }}>
                <strong>#{product.item_number}</strong>
                <span className="price-note" style={{ marginLeft: 0 }}>
                  {product.category_id != null ? categoryName.get(product.category_id) ?? "—" : "—"} ·{" "}
                  {product.vendor_id != null ? vendorName.get(product.vendor_id) ?? "—" : "—"}
                </span>
              </div>
              <label className="field" style={{ flex: "2 1 14rem" }}>
                <span className="label">Name</span>
                <input className="input" name="name" defaultValue={product.name} />
              </label>
              <label className="field" style={{ flex: "1 1 8rem" }}>
                <span className="label">Retail price</span>
                <input
                  className="input"
                  name="retail_price"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={product.retail_price ?? ""}
                />
              </label>
              <label className="field" style={{ flex: "1 1 8rem" }}>
                <span className="label">Category</span>
                <select className="input" name="category_id" defaultValue={product.category_id ?? ""}>
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: "1 1 8rem" }}>
                <span className="label">Vendor</span>
                <select className="input" name="vendor_id" defaultValue={product.vendor_id ?? ""}>
                  <option value="">—</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  <input type="checkbox" name="is_active" defaultChecked={product.is_active} /> Active
                </label>
                <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    name="wholesale_excluded"
                    defaultChecked={product.wholesale_excluded}
                  />{" "}
                  Wholesale excluded
                </label>
                <button type="submit" className="btn" disabled={savingId === product.id}>
                  {savingId === product.id ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Pricing tab ---------------------------------------------------------

function PricingTab({ initial }: { initial: AdminProduct[] }) {
  const [products, setProducts] = useState(initial);
  const [savingId, setSavingId] = useState<number | null>(null);
  const { flash, show } = useFlash();

  async function onSave(productId: number, raw: string) {
    setSavingId(productId);
    const value = raw.trim() === "" ? null : Number(raw);
    const result = await postAction({
      action: "setWholesalePrice",
      product_id: productId,
      wholesale_price: value,
    });
    setSavingId(null);
    if (!result.ok) {
      show("error", result.error ?? "Could not save the price.");
      return;
    }
    setProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, wholesale_price: value } : p)),
    );
    show("success", "Wholesale price saved.");
  }

  return (
    <div className="form">
      <Flash flash={flash} />
      <div className="order-list">
        {products.map((product) => (
          <form
            key={product.id}
            className="order-row"
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("wholesale_price") as HTMLInputElement;
              void onSave(product.id, input.value);
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{product.name}</div>
              <div className="price-note" style={{ marginLeft: 0 }}>
                #{product.item_number} · retail {formatUsd(product.retail_price)}
              </div>
            </div>
            <label className="field" style={{ width: 140 }}>
              <span className="label">Wholesale $</span>
              <input
                className="input"
                name="wholesale_price"
                type="number"
                step="0.01"
                min="0"
                placeholder="—"
                defaultValue={product.wholesale_price ?? ""}
              />
            </label>
            <button type="submit" className="btn" disabled={savingId === product.id}>
              {savingId === product.id ? "Saving…" : "Save"}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}

// --- Approvals tab -------------------------------------------------------

function ApprovalsTab({ initial }: { initial: Customer[] }) {
  const [customers, setCustomers] = useState(initial);
  const [savingId, setSavingId] = useState<string | null>(null);
  const { flash, show } = useFlash();

  async function patch(id: string, input: Record<string, unknown>) {
    setSavingId(id);
    const result = await postAction({ action: "updateCustomer", id, ...input });
    setSavingId(null);
    if (!result.ok) {
      show("error", result.error ?? "Could not update the customer.");
      return;
    }
    const updated = result.customer as Customer | undefined;
    if (updated) {
      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    }
    show("success", "Customer updated.");
  }

  return (
    <div className="form">
      <Flash flash={flash} />
      {customers.length === 0 ? (
        <div className="empty">
          <h2>No customers</h2>
          <p>Customer accounts appear here as they sign up.</p>
        </div>
      ) : (
        <div className="order-list">
          {customers.map((customer) => (
            <div
              key={customer.id}
              className="order-row"
              style={{ flexWrap: "wrap", gap: "0.75rem" }}
            >
              <div style={{ flex: "2 1 14rem" }}>
                <div style={{ fontWeight: 600 }}>{customer.business_name ?? customer.email ?? "—"}</div>
                <div className="price-note" style={{ marginLeft: 0 }}>
                  {customer.email ?? "—"} ·{" "}
                  <span className={customer.approved ? "badge in-stock" : "badge"}>
                    {customer.approved ? "Approved" : "Pending"}
                  </span>
                </div>
              </div>
              <label className="field" style={{ flex: "1 1 10rem" }}>
                <span className="label">Tier</span>
                <select
                  className="input"
                  value={customer.tier}
                  onChange={(e) => void patch(customer.id, { tier: e.currentTarget.value })}
                  disabled={savingId === customer.id}
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={customer.tax_exempt}
                    onChange={(e) => void patch(customer.id, { tax_exempt: e.currentTarget.checked })}
                    disabled={savingId === customer.id}
                  />{" "}
                  Tax-exempt
                </label>
                <button
                  type="button"
                  className={customer.approved ? "btn ghost" : "btn"}
                  disabled={savingId === customer.id}
                  onClick={() => void patch(customer.id, { approved: !customer.approved })}
                >
                  {customer.approved ? "Revoke approval" : "Approve"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Inventory tab -------------------------------------------------------

function InventoryTab({
  initial,
  locations,
}: {
  initial: ProductInventory[];
  locations: Location[];
}) {
  const [inventory, setInventory] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const { flash, show } = useFlash();

  const qtyFor = useCallback(
    (row: ProductInventory, locationId: number) =>
      row.byLocation.find((l) => l.location_id === locationId)?.qty ?? 0,
    [],
  );

  async function onSave(productId: number, locationId: number, raw: string) {
    const key = `${productId}:${locationId}`;
    setSaving(key);
    const qty = Number(raw);
    const result = await postAction({
      action: "adjustInventory",
      product_id: productId,
      location_id: locationId,
      qty,
    });
    setSaving(null);
    if (!result.ok) {
      show("error", result.error ?? "Could not adjust inventory.");
      return;
    }
    setInventory((prev) =>
      prev.map((row) => {
        if (row.product_id !== productId) return row;
        const existing = row.byLocation.find((l) => l.location_id === locationId);
        const byLocation = existing
          ? row.byLocation.map((l) => (l.location_id === locationId ? { ...l, qty } : l))
          : [...row.byLocation, { id: 0, product_id: productId, location_id: locationId, qty }];
        return { ...row, byLocation };
      }),
    );
    show("success", "Inventory updated.");
  }

  if (locations.length === 0) {
    return (
      <div className="empty">
        <h2>No locations</h2>
        <p>Add locations to the catalog before adjusting per-location inventory.</p>
      </div>
    );
  }

  return (
    <div className="form">
      <Flash flash={flash} />
      <div className="order-list">
        {inventory.map((row) => (
          <div key={row.product_id} className="order-row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
            <div style={{ flexBasis: "100%", fontWeight: 600 }}>
              {row.product_name} <span className="price-note">#{row.item_number}</span>
            </div>
            {locations.map((location) => {
              const key = `${row.product_id}:${location.id}`;
              return (
                <label key={location.id} className="field" style={{ width: 140 }}>
                  <span className="label">{location.name}</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    defaultValue={qtyFor(row, location.id)}
                    disabled={saving === key}
                    onBlur={(e) => void onSave(row.product_id, location.id, e.currentTarget.value)}
                  />
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <p className="price-note" style={{ marginLeft: 0 }}>
        Quantities save when you leave a field.
      </p>
    </div>
  );
}

// --- Orders tab ----------------------------------------------------------

function OrdersTab({ initial }: { initial: Order[] }) {
  const [orders, setOrders] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const { flash, show } = useFlash();

  async function advance(orderId: string, status: OrderStatus) {
    setSaving(orderId);
    const result = await postAction({ action: "advanceOrder", order_id: orderId, status });
    setSaving(null);
    if (!result.ok) {
      show("error", result.error ?? "Could not advance the order.");
      return;
    }
    const updated = result.order as Order | undefined;
    if (updated) {
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    }
    show("success", `Order ${orderId.slice(0, 8)} → ${status}.`);
  }

  if (orders.length === 0) {
    return (
      <div className="empty">
        <h2>No orders</h2>
        <p>Submitted customer orders appear here for confirmation and fulfillment.</p>
      </div>
    );
  }

  return (
    <div className="form">
      <Flash flash={flash} />
      <div className="order-list">
        {orders.map((order) => {
          const next = ADMIN_ORDER_TRANSITIONS[order.status] ?? [];
          return (
            <div key={order.id} className="order-row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
              <div style={{ flex: "2 1 16rem" }}>
                <div style={{ fontWeight: 600 }}>
                  #{order.id.slice(0, 8)}{" "}
                  <span className={statusBadgeClass(order.status)}>{order.status}</span>
                </div>
                <div className="price-note" style={{ marginLeft: 0 }}>
                  {order.items.length} item{order.items.length === 1 ? "" : "s"} ·{" "}
                  {formatUsd(order.subtotal)}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {next.length === 0 ? (
                  <span className="price-note" style={{ marginLeft: 0 }}>
                    No further actions
                  </span>
                ) : (
                  next.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={status === "cancelled" ? "btn ghost" : "btn"}
                      disabled={saving === order.id}
                      onClick={() => void advance(order.id, status)}
                    >
                      {status === "confirmed"
                        ? "Confirm"
                        : status === "fulfilled"
                          ? "Mark fulfilled"
                          : "Cancel"}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The staff admin dashboard. Renders the tab switcher and the active tab over
 * the commerce data. All mutations route through the gated /api/admin endpoint.
 */
export function AdminDashboard({
  title = "Admin",
  setupRequired = false,
  notAuthorized = false,
  products,
  customers,
  inventory,
  orders,
  categories,
  vendors,
  locations,
}: AdminDashboardProps) {
  const [tab, setTab] = useState<TabId>("catalog");

  if (notAuthorized) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Staff admin</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Not authorized.</strong> You do not have access to the staff admin dashboard.
          </div>
        </section>
      </div>
    );
  }

  if (setupRequired) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Staff admin</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Setup required.</strong> The admin dashboard is not yet configured for this
            site. Contact your administrator.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="container">
        <header className="page-head">
          <span className="eyebrow">Staff admin</span>
          <h1>{title}</h1>
          <p className="lede">Manage catalog, pricing, approvals, inventory, and orders.</p>
        </header>

        <div className="tabs" role="tablist" style={{ marginBottom: "1.5rem", flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "catalog" ? (
          <CatalogTab initial={products} categories={categories} vendors={vendors} />
        ) : null}
        {tab === "pricing" ? <PricingTab initial={products} /> : null}
        {tab === "approvals" ? <ApprovalsTab initial={customers} /> : null}
        {tab === "inventory" ? <InventoryTab initial={inventory} locations={locations} /> : null}
        {tab === "orders" ? <OrdersTab initial={orders} /> : null}
      </section>
    </div>
  );
}
