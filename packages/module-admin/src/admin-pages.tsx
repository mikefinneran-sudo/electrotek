import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { oauthErrorMessage } from "./oauth-error-text";
import { formatPrice } from "@waltersignal/bananaforce-module-catalog/pricing";
import { fetchLeadAttachmentsByLead } from "@waltersignal/bananaforce-module-lead-capture/server";
import { LeadDetails } from "@waltersignal/bananaforce-module-lead-capture/ui";
import { fetchAllRows } from "@waltersignal/bananaforce-data-supabase/pagination";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { getSupabaseServiceClient } from "@waltersignal/bananaforce-data-supabase/service";
import {
  advanceOrderAction,
  setInventory,
  updateCustomerAction,
  updateInquiryStatusAction,
  updateLocationAction,
} from "./actions";
import { getSignedInEmail, getStaffUser, requireStaff } from "./auth";
import { InventoryPanel } from "./inventory-panel";
import { InventoryToolbar } from "./inventory-toolbar";
import { NewProductForm } from "./new-product-form";
import { ProductEditForm } from "./product-edit-form";
import { SignOutButton } from "./sign-out";
import { StaffLoginForm } from "./login-form";
import { StaffPanel } from "./staff-panel";

const AUDIT_PAGE_SIZE = 50;

type AuditSearchParams = {
  page?: string | string[];
};

type AuditLogRow = {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  action: string | null;
  resource_type: string | null;
  resource_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
};

function pageFromSearchParams(params: AuditSearchParams): number {
  const raw = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Number(raw ?? "1");
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function formatAuditDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function jsonPreview(value: unknown): string {
  if (value == null) return "—";
  const raw =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  return raw.length > 180 ? `${raw.slice(0, 180)}...` : raw;
}

export function createAdminLoginPage(clientConfig: ClientConfig) {
  return async function AdminLoginPage({
    searchParams,
  }: {
    searchParams?: Promise<{ error?: string | string[] }>;
  } = {}) {
    const staffHome = clientConfig.auth?.staff?.staffHome ?? "/admin";
    const staff = await getStaffUser();
    if (staff) redirect(staffHome);
    const email = await getSignedInEmail();

    const params = searchParams ? await searchParams : {};
    const rawError = Array.isArray(params.error) ? params.error[0] : params.error;
    const errorMessage = rawError ? oauthErrorMessage(rawError) : null;

    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 480 }}>
          <header className="page-head">
            <span className="eyebrow">Staff</span>
            <h1>{clientConfig.brand.name} — sign in</h1>
          </header>
          <div className="panel pad">
            {errorMessage ? (
              <p className="form-msg error" role="alert">
                {errorMessage}
              </p>
            ) : null}
            {email ? (
              <div className="callout tint">
                <p>
                  Signed in as <strong>{email}</strong>, which is not on the staff list. Ask an
                  admin to provision your account, or sign out and use a staff login.
                </p>
                <div style={{ marginTop: "1rem" }}>
                  <SignOutButton />
                </div>
              </div>
            ) : (
              <StaffLoginForm
                homeRoute={staffHome}
                googleWorkspaceDomain={clientConfig.auth?.staff?.googleWorkspaceDomain}
              />
            )}
          </div>
        </section>
      </div>
    );
  };
}

export function createAdminDashboardPage() {
  return async function AdminDashboardPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const [events, inquiries, orders] = await Promise.all([
      supabase.from("event_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("wholesale_inquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    ]);

    const cards = [
      { href: "/admin/events", label: "New event requests", value: events.count },
      { href: "/admin/wholesale", label: "New wholesale inquiries", value: inquiries.count },
      { href: "/admin/orders", label: "Open orders", value: orders.count },
    ];

    return (
      <div>
        <header className="page-head">
          <h1>Dashboard</h1>
          <p className="lede">Back-office overview.</p>
        </header>
        <div className="admin-card-grid">
          {cards.map((c) => (
            <Link key={c.href} href={c.href} className="admin-card">
              <div className="admin-card-value">{c.value ?? "—"}</div>
              <div className="admin-card-label">{c.label}</div>
            </Link>
          ))}
        </div>
      </div>
    );
  };
}

export function createAdminAuditPage() {
  return async function AdminAuditPage({
    searchParams,
  }: {
    searchParams?: Promise<AuditSearchParams>;
  }) {
    const me = await requireStaff();
    if (me.role !== "admin") {
      return (
        <div>
          <header className="page-head">
            <h1>Audit log</h1>
          </header>
          <div className="callout">Audit log access is limited to admins.</div>
        </div>
      );
    }

    const params = searchParams ? await searchParams : {};
    const page = pageFromSearchParams(params);
    const from = (page - 1) * AUDIT_PAGE_SIZE;
    const to = from + AUDIT_PAGE_SIZE - 1;
    const supabase = getSupabaseServiceClient();

    if (!supabase) {
      return (
        <div>
          <header className="page-head">
            <h1>Audit log</h1>
          </header>
          <div className="callout">Audit log is not configured.</div>
        </div>
      );
    }

    const [{ count, error: countError }, rowsResult] = await Promise.all([
      supabase.from("audit_log").select("id", { count: "exact", head: true }),
      fetchAllRows<AuditLogRow>((chunkFrom, chunkTo) =>
        supabase
          .from("audit_log")
          .select(
            "id, actor_id, actor_email, action, resource_type, resource_id, before, after, created_at",
          )
          .order("created_at", { ascending: false })
          .range(from + chunkFrom, Math.min(from + chunkTo, to)) as PromiseLike<{
          data: AuditLogRow[] | null;
          error: { message: string } | null;
        }>,
      ),
    ]);

    const rows = rowsResult.data;
    const total = count ?? rows.length;
    const hasNext = page * AUDIT_PAGE_SIZE < total;

    return (
      <div>
        <header className="page-head">
          <h1>Audit log</h1>
          <p className="lede">{total} recorded event(s)</p>
        </header>
        {countError || rowsResult.error ? (
          <div className="callout">
            {(countError ?? rowsResult.error)?.message ?? "Could not load audit log."}
          </div>
        ) : rows.length === 0 ? (
          <p className="price-note">No audit entries found.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td className="price-note">{formatAuditDate(entry.created_at)}</td>
                    <td>{entry.actor_email ?? entry.actor_id ?? "System"}</td>
                    <td>
                      <span className="badge">{entry.action ?? "unknown"}</span>
                    </td>
                    <td>
                      {entry.resource_type ?? "resource"}
                      {entry.resource_id ? (
                        <div className="price-note">{entry.resource_id}</div>
                      ) : null}
                    </td>
                    <td className="price-note">
                      <code>{jsonPreview(entry.before)}</code>
                    </td>
                    <td className="price-note">
                      <code>{jsonPreview(entry.after)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions" style={{ marginTop: "1rem" }}>
          {page > 1 ? (
            <Link className="btn ghost" href={`/admin/audit?page=${page - 1}`}>
              Previous
            </Link>
          ) : null}
          {hasNext ? (
            <Link className="btn ghost" href={`/admin/audit?page=${page + 1}`}>
              Next
            </Link>
          ) : null}
        </div>
      </div>
    );
  };
}

export function createAdminCustomersPage() {
  return async function AdminCustomersPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const [{ data }, { data: staffRows }] = await Promise.all([
      supabase
        .from("customers")
        .select("id, email, business_name, tier, tax_exempt, approved, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("staff").select("email"),
    ]);
    const staffEmails = new Set(
      ((staffRows as { email: string }[] | null) ?? []).map((s) => s.email.toLowerCase()),
    );
    const rows =
      ((data as { id: string; email: string | null; business_name: string | null; tier: string; approved: boolean }[]) ??
        []).filter((c) => !c.email || !staffEmails.has(c.email.toLowerCase()));

    return (
      <div>
        <header className="page-head">
          <h1>Customers</h1>
          <p className="lede">Approve wholesale accounts and set tiers.</p>
        </header>
        <div className="order-list" style={{ marginTop: "1.5rem" }}>
          {rows.map((c) => (
            <form key={c.id} action={updateCustomerAction} className="order-row" style={{ flexWrap: "wrap" }}>
              <input type="hidden" name="id" value={c.id} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <strong>{c.business_name || c.email || "—"}</strong>
                {c.business_name ? <div className="price-note">{c.email}</div> : null}
              </div>
              <select className="input" name="tier" defaultValue={c.tier}>
                <option value="retail">Retail</option>
                <option value="wholesale_taxed">Wholesale (taxed)</option>
                <option value="wholesale_exempt">Wholesale (tax-exempt)</option>
              </select>
              <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                <input type="checkbox" name="approved" defaultChecked={c.approved} /> Approved
              </label>
              <button type="submit" className="btn">
                Save
              </button>
            </form>
          ))}
        </div>
      </div>
    );
  };
}

export function createAdminOrdersPage() {
  return async function AdminOrdersPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase
      .from("orders")
      .select("id, status, subtotal, created_at, customers(email, business_name)")
      .neq("status", "cart")
      .order("created_at", { ascending: false });
    const rows = (data as unknown as {
      id: string;
      status: string;
      subtotal: number;
      created_at: string;
      customers: { email: string | null; business_name: string | null } | null;
    }[]) ?? [];

    return (
      <div>
        <header className="page-head">
          <h1>Orders</h1>
          <p className="lede">{rows.length} submitted orders</p>
        </header>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Subtotal</th>
                <th style={{ textAlign: "right" }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/admin/orders/${o.id}`} className="inline-link">
                      #{o.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{o.customers?.business_name || o.customers?.email || "—"}</td>
                  <td>
                    <span className="badge">{o.status}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{formatPrice(o.subtotal)}</td>
                  <td style={{ textAlign: "right", color: "var(--muted)" }}>
                    {new Date(o.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
}

export function createAdminOrderDetailPage() {
  return async function AdminOrderDetailPage({
    params,
  }: {
    params: Promise<{ id: string }>;
  }) {
    await requireStaff();
    const { id } = await params;
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase
      .from("orders")
      .select(
        "id, status, subtotal, notes, created_at, customers(email, business_name, tier), order_items(qty, unit_price, line_total, products(name, item_number))",
      )
      .eq("id", id)
      .maybeSingle();
    if (!data) notFound();

    const order = data as unknown as {
      id: string;
      status: string;
      subtotal: number;
      notes: string | null;
      created_at: string;
      customers: { email: string | null; business_name: string | null; tier: string } | null;
      order_items: {
        qty: number;
        unit_price: number;
        line_total: number;
        products: { name: string; item_number: number } | null;
      }[];
    };

    return (
      <div>
        <p>
          <Link href="/admin/orders" className="back-link">
            ← Orders
          </Link>
        </p>
        <header className="page-head">
          <h1>Order #{order.id.slice(0, 8)}</h1>
          <p className="lede">
            {order.customers?.business_name || order.customers?.email || "Customer"} ·{" "}
            <span className="badge">{order.status}</span>
          </p>
        </header>
        <div className="order-list">
          {order.order_items.map((item, i) => (
            <div key={i} className="order-row">
              <div style={{ flex: 1 }}>
                {item.qty}× {item.products?.name ?? "Item"} #{item.products?.item_number ?? "—"}
              </div>
              <div>{formatPrice(item.line_total)}</div>
            </div>
          ))}
        </div>
        <div className="order-total">
          <strong>Subtotal</strong>
          <strong>{formatPrice(order.subtotal)}</strong>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
          {order.status === "submitted" ? (
            <>
              <form action={advanceOrderAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="status" value="confirmed" />
                <button type="submit" className="btn">
                  Confirm
                </button>
              </form>
              <form action={advanceOrderAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="status" value="cancelled" />
                <button type="submit" className="btn ghost">
                  Cancel
                </button>
              </form>
            </>
          ) : null}
          {order.status === "confirmed" ? (
            <form action={advanceOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="status" value="fulfilled" />
              <button type="submit" className="btn">
                Mark fulfilled
              </button>
            </form>
          ) : null}
        </div>
      </div>
    );
  };
}

export function createAdminCatalogPage() {
  return async function AdminCatalogPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase
      .from("products")
      .select(
        "id, item_number, name, retail_price, unit_price, promo_type, deal_qty, deal_price, is_featured, is_active, product_wholesale_prices(wholesale_price)",
      )
      .order("name");

    const rows = (data as unknown as {
      id: number;
      item_number: number;
      name: string;
      retail_price: number | null;
      unit_price: number | null;
      promo_type: "bogo" | "volume" | null;
      deal_qty: number | null;
      deal_price: number | null;
      is_featured: boolean;
      is_active: boolean;
      product_wholesale_prices:
        | { wholesale_price: number | null }
        | { wholesale_price: number | null }[]
        | null;
    }[]) ?? [];

    return (
      <div>
        <header className="page-head">
          <h1>Catalog</h1>
          <p className="lede">Product visibility, featured flags, and customer pricing.</p>
        </header>
        <div className="admin-table-wrap" style={{ marginTop: "1.5rem" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Item #</th>
                <th>Product</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Retail</th>
                <th style={{ textAlign: "right" }}>Wholesale</th>
                <th style={{ textAlign: "right" }}>Promo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const wholesale = Array.isArray(product.product_wholesale_prices)
                  ? product.product_wholesale_prices[0]?.wholesale_price
                  : product.product_wholesale_prices?.wholesale_price;
                const promo =
                  product.promo_type === "bogo"
                    ? "BOGO"
                    : product.promo_type === "volume" && product.deal_qty
                      ? `${product.deal_qty}+`
                      : "—";

                return (
                  <tr key={product.id}>
                    <td className="price-note">{product.item_number}</td>
                    <td>
                      <strong>{product.name}</strong>
                      {product.is_featured ? <div className="price-note">Featured</div> : null}
                    </td>
                    <td>
                      <span className={`badge ${product.is_active ? "" : "low-stock"}`}>
                        {product.is_active ? "Active" : "Hidden"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{formatPrice(product.retail_price)}</td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>
                      {wholesale != null ? formatPrice(wholesale) : "—"}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>{promo}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/admin/inventory/${product.id}`} className="inline-link">
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
}

export function createAdminInventoryPage() {
  return async function AdminInventoryPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const [{ data: locations }, { data: products }, { data: inventory }, { data: wholesale }] =
      await Promise.all([
        supabase.from("locations").select("id, slug, name, city").order("sort_order"),
        supabase
          .from("products")
          .select("id, item_number, name, retail_price, image_url, is_active")
          .order("name"),
        supabase.from("inventory").select("product_id, location_id, qty"),
        supabase.from("product_wholesale_prices").select("product_id, wholesale_price"),
      ]);

    const wholesaleByProduct: Record<number, number> = {};
    for (const row of wholesale ?? []) {
      wholesaleByProduct[row.product_id as number] = Number(row.wholesale_price);
    }

    return (
      <div>
        <header className="page-head">
          <h1>Inventory</h1>
          <p className="lede">Per-location stock and product catalog edits.</p>
        </header>
        <InventoryToolbar
          locations={(locations ?? []) as { id: number; name: string; slug: string; city?: string | null }[]}
          products={(products ?? []) as {
            id: number;
            item_number: number;
            name: string;
          }[]}
        />
        <InventoryPanel
          locations={(locations ?? []) as { id: number; name: string; slug: string; city?: string | null }[]}
          products={(products ?? []) as {
            id: number;
            item_number: number;
            name: string;
            retail_price: number | null;
            image_url: string | null;
            is_active: boolean;
          }[]}
          wholesaleByProduct={wholesaleByProduct}
          inventory={(inventory ?? []) as { product_id: number; location_id: number; qty: number }[]}
          setInventoryAction={setInventory}
        />
      </div>
    );
  };
}

export function createAdminProductNewPage() {
  return async function AdminProductNewPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const [{ data: categories }, { data: vendors }] = await Promise.all([
      supabase.from("categories").select("id, name").order("sort_order"),
      supabase.from("vendors").select("id, name").order("name"),
    ]);

    return (
      <div>
        <header className="page-head">
          <h1>New product</h1>
          <p className="lede">Create a catalog item before receiving or adjusting stock.</p>
        </header>
        <NewProductForm
          categories={(categories ?? []) as { id: number; name: string }[]}
          vendors={(vendors ?? []) as { id: number; name: string }[]}
        />
      </div>
    );
  };
}

export function createAdminProductEditPage() {
  return async function AdminProductEditPage({
    params,
  }: {
    params: Promise<{ productId: string }>;
  }) {
    await requireStaff();
    const { productId } = await params;
    const id = Number(productId);
    if (!Number.isInteger(id) || id <= 0) notFound();

    const supabase = await getSupabaseServerClient();
    const [{ data: product }, { data: wholesale }] = await Promise.all([
      supabase.from("products").select("*").eq("id", id).maybeSingle(),
      supabase.from("product_wholesale_prices").select("wholesale_price").eq("product_id", id).maybeSingle(),
    ]);
    if (!product) notFound();

    return (
      <div>
        <header className="page-head">
          <h1>Edit product #{product.item_number as number}</h1>
        </header>
        <ProductEditForm
          product={{
            id: product.id as number,
            item_number: product.item_number as number,
            name: product.name as string,
            pack: product.pack as string | null,
            sold_as: product.sold_as as string | null,
            retail_price: product.retail_price != null ? Number(product.retail_price) : null,
            unit_price: product.unit_price != null ? Number(product.unit_price) : null,
            promo_type: (product.promo_type as "bogo" | "volume" | null) ?? null,
            deal_qty: product.deal_qty as number | null,
            deal_price: product.deal_price != null ? Number(product.deal_price) : null,
            wholesale_excluded: Boolean(product.wholesale_excluded),
            is_active: Boolean(product.is_active),
            is_featured: Boolean(product.is_featured ?? false),
            description: product.description as string | null,
            image_url: product.image_url as string | null,
            upc: product.upc as string | null,
            wholesale_price:
              wholesale?.wholesale_price != null ? Number(wholesale.wholesale_price) : null,
          }}
        />
      </div>
    );
  };
}

export function createAdminEventsPage() {
  return async function AdminEventsPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase
      .from("event_requests")
      .select("*")
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as {
      id: string;
      name: string;
      email: string;
      event_type: string | null;
      status: string;
      created_at: string;
    }[];

    return (
      <div>
        <header className="page-head">
          <h1>Event requests</h1>
        </header>
        <div className="order-list" style={{ marginTop: "1.5rem" }}>
          {rows.map((r) => (
            <form key={r.id} action={updateInquiryStatusAction} className="order-row" style={{ flexWrap: "wrap" }}>
              <input type="hidden" name="table" value="event_requests" />
              <input type="hidden" name="id" value={r.id} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{r.name}</strong>
                <div className="price-note">
                  {r.email} · {r.event_type ?? "Event"}
                </div>
              </div>
              <select className="input" name="status" defaultValue={r.status}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="quoted">Quoted</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
              <button type="submit" className="btn">
                Save
              </button>
            </form>
          ))}
        </div>
      </div>
    );
  };
}

export function createAdminWholesalePage() {
  return async function AdminWholesalePage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase
      .from("wholesale_inquiries")
      .select("*")
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as {
      id: string;
      company: string;
      contact_name: string;
      email: string;
      status: string;
    }[];

    return (
      <div>
        <header className="page-head">
          <h1>Wholesale inquiries</h1>
        </header>
        <div className="order-list" style={{ marginTop: "1.5rem" }}>
          {rows.map((r) => (
            <form key={r.id} action={updateInquiryStatusAction} className="order-row" style={{ flexWrap: "wrap" }}>
              <input type="hidden" name="table" value="wholesale_inquiries" />
              <input type="hidden" name="id" value={r.id} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{r.company}</strong>
                <div className="price-note">
                  {r.contact_name} · {r.email}
                </div>
              </div>
              <select className="input" name="status" defaultValue={r.status}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="approved">Approved</option>
                <option value="declined">Declined</option>
              </select>
              <button type="submit" className="btn">
                Save
              </button>
            </form>
          ))}
        </div>
      </div>
    );
  };
}

export function createAdminLeadsPage() {
  return async function AdminLeadsPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase
      .from("leads")
      .select("id,name,email,company,phone,notes,source,status,submitted_at,metadata")
      .order("submitted_at", { ascending: false })
      .limit(200);
    const rows = (data ?? []) as {
      id: string;
      name: string;
      email: string;
      company: string | null;
      phone: string | null;
      notes: string | null;
      source: string | null;
      status: string;
      submitted_at: string;
      metadata: Record<string, unknown> | null;
    }[];
    // One query for the whole page, not one per lead. Download URLs are signed
    // here, at render time, because they expire.
    const attachmentsByLead = await fetchLeadAttachmentsByLead(rows.map((r) => r.id));

    return (
      <div>
        <header className="page-head">
          <h1>Leads</h1>
          <p className="dashboard-lede">Inbound contact-form submissions.</p>
        </header>
        <div className="order-list" style={{ marginTop: "1.5rem" }}>
          {rows.length === 0 ? (
            <p className="price-note">No leads yet.</p>
          ) : (
            rows.map((r) => (
              <form
                key={r.id}
                action={updateInquiryStatusAction}
                className="order-row"
                style={{ flexWrap: "wrap" }}
              >
                <input type="hidden" name="table" value="leads" />
                <input type="hidden" name="id" value={r.id} />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <strong>{r.name}</strong>
                  <div className="price-note">
                    {r.email}
                    {r.company ? ` · ${r.company}` : ""}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </div>
                  {r.notes ? (
                    <div className="price-note" style={{ marginTop: 4 }}>
                      {r.notes.length > 160 ? `${r.notes.slice(0, 160)}…` : r.notes}
                    </div>
                  ) : null}
                  <div className="price-note" style={{ marginTop: 4, opacity: 0.7 }}>
                    {new Date(r.submitted_at).toLocaleString()}
                    {r.source ? ` · ${r.source}` : ""}
                  </div>
                  <LeadDetails
                    metadata={r.metadata}
                    attachments={attachmentsByLead.get(r.id) ?? null}
                  />
                </div>
                <select className="input" name="status" defaultValue={r.status}>
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="qualified">Qualified</option>
                  <option value="converted">Converted</option>
                  <option value="lost">Lost</option>
                </select>
                <button type="submit" className="btn">
                  Save
                </button>
              </form>
            ))
          )}
        </div>
      </div>
    );
  };
}

export function createAdminClientsPage() {
  return async function AdminClientsPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase
      .from("issue_reports")
      .select("id,inspection_id,message,severity,status,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const rows = (data ?? []) as {
      id: string;
      inspection_id: string;
      message: string;
      severity: string | null;
      status: string;
      created_at: string;
    }[];

    return (
      <div>
        <header className="page-head">
          <h1>Client issue reports</h1>
          <p className="dashboard-lede">
            Issues submitted by clients through the token-gated portal.
          </p>
        </header>
        <div className="order-list" style={{ marginTop: "1.5rem" }}>
          {rows.length === 0 ? (
            <p className="price-note">No issue reports.</p>
          ) : (
            rows.map((r) => (
              <form
                key={r.id}
                action={updateInquiryStatusAction}
                className="order-row"
                style={{ flexWrap: "wrap" }}
              >
                <input type="hidden" name="table" value="issue_reports" />
                <input type="hidden" name="id" value={r.id} />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <strong>{r.severity ? `${r.severity.toUpperCase()} severity` : "Issue"}</strong>
                  <div className="price-note" style={{ marginTop: 4 }}>
                    {r.message.length > 200 ? `${r.message.slice(0, 200)}…` : r.message}
                  </div>
                  <div className="price-note" style={{ marginTop: 4, opacity: 0.7 }}>
                    {new Date(r.created_at).toLocaleString()} · account{" "}
                    {r.inspection_id.slice(0, 8)}
                  </div>
                </div>
                <select className="input" name="status" defaultValue={r.status}>
                  <option value="new">New</option>
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <button type="submit" className="btn">
                  Save
                </button>
              </form>
            ))
          )}
        </div>
      </div>
    );
  };
}

export function createAdminLocationsPage() {
  return async function AdminLocationsPage() {
    await requireStaff();
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.from("locations").select("*").order("sort_order");
    const rows = (data ?? []) as {
      id: number;
      name: string;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      phone: string | null;
      hours: string | null;
    }[];

    return (
      <div>
        <header className="page-head">
          <h1>Locations</h1>
        </header>
        <div className="order-list" style={{ marginTop: "1.5rem" }}>
          {rows.map((loc) => (
            <form key={loc.id} action={updateLocationAction} className="order-row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
              <input type="hidden" name="id" value={loc.id} />
              <label className="field" style={{ flex: "1 1 12rem" }}>
                <span className="label">Name</span>
                <input className="input" name="name" defaultValue={loc.name} />
              </label>
              <label className="field" style={{ flex: "1 1 10rem" }}>
                <span className="label">Phone</span>
                <input className="input" name="phone" defaultValue={loc.phone ?? ""} />
              </label>
              <label className="field" style={{ flex: "1 1 16rem" }}>
                <span className="label">Hours</span>
                <input className="input" name="hours" defaultValue={loc.hours ?? ""} />
              </label>
              <button type="submit" className="btn">
                Save
              </button>
            </form>
          ))}
        </div>
      </div>
    );
  };
}

export function createAdminStaffPage() {
  return async function AdminStaffPage() {
    const me = await requireStaff();
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.from("staff").select("id, email, name, role").order("email");
    return (
      <StaffPanel
        currentUserId={me.id}
        isAdmin={me.role === "admin"}
        rows={(data ?? []) as { id: string; email: string; name: string | null; role: string }[]}
      />
    );
  };
}
