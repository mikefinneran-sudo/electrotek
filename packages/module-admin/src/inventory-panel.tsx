"use client";

import Link from "next/link";
import { useState } from "react";
import { formatPrice } from "@waltersignal/bananaforce-module-catalog/pricing";

type Loc = { id: number; name: string; slug?: string; city?: string | null };
type Prod = {
  id: number;
  item_number: number;
  name: string;
  retail_price: number | null;
  image_url: string | null;
  is_active: boolean;
};
type Inv = { product_id: number; location_id: number; qty: number };

export function InventoryPanel({
  locations,
  products,
  wholesaleByProduct,
  inventory,
  setInventoryAction,
}: {
  locations: Loc[];
  products: Prod[];
  wholesaleByProduct: Record<number, number>;
  inventory: Inv[];
  setInventoryAction: (formData: FormData) => Promise<void>;
}) {
  const [active, setActive] = useState<number | "all">(locations[0]?.id ?? "all");
  const [q, setQ] = useState("");

  const qtyMap = new Map<string, number>();
  const totals = new Map<number, number>();
  for (const r of inventory) {
    qtyMap.set(`${r.location_id}:${r.product_id}`, Number(r.qty));
    totals.set(r.product_id, (totals.get(r.product_id) ?? 0) + Number(r.qty));
  }

  const ql = q.trim().toLowerCase();
  const rows = products.filter(
    (p) => !ql || p.name.toLowerCase().includes(ql) || String(p.item_number).includes(ql),
  );

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div className="tabs" role="tablist">
        <button
          type="button"
          className={`tab${active === "all" ? " active" : ""}`}
          onClick={() => setActive("all")}
        >
          All locations
        </button>
        {locations.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`tab${active === l.id ? " active" : ""}`}
            onClick={() => setActive(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "1rem", margin: "1rem 0", alignItems: "center" }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search product or item #…"
          style={{ maxWidth: 280 }}
        />
        <span className="price-note">{rows.length} products</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Item #</th>
              <th>Product</th>
              <th style={{ textAlign: "right" }}>Retail</th>
              <th style={{ textAlign: "right" }}>Wholesale</th>
              <th style={{ textAlign: "right" }}>{active === "all" ? "On hand (all)" : "On hand"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="price-note">{p.item_number}</td>
                <td>
                  <span style={p.is_active ? undefined : { textDecoration: "line-through", color: "var(--muted)" }}>
                    {p.name}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>{formatPrice(p.retail_price)}</td>
                <td style={{ textAlign: "right", color: "var(--muted)" }}>
                  {wholesaleByProduct[p.id] != null ? formatPrice(wholesaleByProduct[p.id]) : "—"}
                </td>
                <td style={{ textAlign: "right" }}>
                  {active === "all" ? (
                    totals.get(p.id) ?? 0
                  ) : (
                    <form action={setInventoryAction} style={{ display: "flex", gap: "0.35rem", justifyContent: "flex-end" }}>
                      <input type="hidden" name="productId" value={p.id} />
                      <input type="hidden" name="locationId" value={active} />
                      <input
                        className="input"
                        name="qty"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={qtyMap.get(`${active}:${p.id}`) ?? 0}
                        style={{ width: 72, textAlign: "right" }}
                      />
                      <button type="submit" className="btn">
                        Save
                      </button>
                    </form>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link href={`/admin/inventory/${p.id}`} className="inline-link">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
