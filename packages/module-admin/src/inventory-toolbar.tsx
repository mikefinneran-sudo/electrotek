"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { importMasterSheet, setInventory } from "./actions";

type LocationOption = { id: number; name: string; slug: string; city?: string | null };
type ProductOption = { id: number; item_number: number; name: string };

type ImportResult = {
  ok: boolean;
  message: string;
  productsCreated?: number;
  productsUpdated?: number;
  inventoryUpdated?: number;
  skipped?: number;
  errors?: string[];
};

export function InventoryToolbar({
  locations,
  products,
}: {
  locations: LocationOption[];
  products: ProductOption[];
}) {
  const [selectedLocationId, setSelectedLocationId] = useState<number>(locations[0]?.id ?? 0);
  const [productQuery, setProductQuery] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const selectedLocation =
    locations.find((location) => location.id === selectedLocationId) ?? locations[0] ?? null;
  const exportHref = (format: "csv" | "xlsx" | "pdf") => {
    const params = new URLSearchParams({ format });
    if (selectedLocation) params.set("location", selectedLocation.slug);
    return `/admin/inventory/export?${params.toString()}`;
  };
  const query = productQuery.trim().toLowerCase();
  const productMatches = useMemo(
    () =>
      query
        ? products.filter(
            (product) =>
              product.name.toLowerCase().includes(query) ||
              String(product.item_number).includes(query),
          )
        : products,
    [products, query],
  );

  function handleImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await importMasterSheet(formData);
      setImportResult(result);
      if (result.ok) {
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  }

  return (
    <section className="panel pad" style={{ marginTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">Master sheet</span>
          <p className="price-note" style={{ margin: "0.35rem 0 0" }}>
            Export as Excel, CSV, or a printable PDF count sheet. Import CSV or
            XLSX, and make quick stock adjustments.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          <Link href="/admin/inventory/new" className="btn ghost">
            New product
          </Link>
          <a href={exportHref("xlsx")} className="btn">
            Export Excel
          </a>
          <a href={exportHref("csv")} className="btn ghost">
            Export CSV
          </a>
          <a href={exportHref("pdf")} className="btn ghost">
            Print PDF
          </a>
        </div>
      </div>

      <div className="form" style={{ marginTop: "1.25rem" }}>
        <form action={setInventory} className="form">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
            <label className="field">
              <span className="label">Location</span>
              <select
                className="input"
                name="locationId"
                value={selectedLocationId || ""}
                onChange={(event) => setSelectedLocationId(Number(event.target.value))}
                required
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="label">Find product</span>
              <input
                className="input"
                type="search"
                value={productQuery}
                onChange={(event) => setProductQuery(event.target.value)}
                placeholder="Item # or name"
              />
            </label>

            <label className="field">
              <span className="label">Product</span>
              <select className="input" name="productId" required>
                {productMatches.slice(0, 200).map((product) => (
                  <option key={product.id} value={product.id}>
                    #{product.item_number} {product.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="label">On Hand</span>
              <input className="input" name="qty" type="number" min="0" step="0.01" defaultValue="0" required />
            </label>
          </div>
          <button type="submit" className="btn">
            Save qty
          </button>
        </form>

        <form onSubmit={handleImport} className="form">
          <input type="hidden" name="stockLocationId" value={selectedLocation?.id ?? ""} />
          <label className="field">
            <span className="label">Import CSV or XLSX</span>
            <input
              ref={fileRef}
              className="input"
              name="file"
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
            />
          </label>
          <button type="submit" className="btn ghost" disabled={pending}>
            {pending ? "Importing..." : "Import master sheet"}
          </button>
          {importResult ? (
            <p className={`form-msg ${importResult.ok ? "success" : "error"}`} role="status">
              {importResult.message}
              {importResult.errors?.length ? ` ${importResult.errors.join(" ")}` : ""}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}
