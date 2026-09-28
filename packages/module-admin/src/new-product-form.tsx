"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createProduct } from "./actions";

type Option = { id: number; name: string };

export function NewProductForm({
  categories,
  vendors,
}: {
  categories: Option[];
  vendors: Option[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createProduct(formData);
      setMessage(result.message ?? (result.ok ? "Product created." : "Could not create product."));
      if (result.ok && result.productId) {
        router.push(`/admin/inventory/${result.productId}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="panel pad form" style={{ marginTop: "1.5rem" }}>
      <Link href="/admin/inventory" className="back-link">
        Back to inventory
      </Link>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
        <label className="field">
          <span className="label">Item #</span>
          <input className="input" name="item_number" type="number" min="1" step="1" required />
        </label>
        <label className="field">
          <span className="label">Name</span>
          <input className="input" name="name" required />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
        <label className="field">
          <span className="label">Category</span>
          <select className="input" name="category_id" defaultValue="">
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Vendor</span>
          <select className="input" name="vendor_id" defaultValue="">
            <option value="">No vendor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>
        <label className="field">
          <span className="label">Pack</span>
          <input className="input" name="pack" />
        </label>
        <label className="field">
          <span className="label">Sold as</span>
          <input className="input" name="sold_as" />
        </label>
        <label className="field">
          <span className="label">Brand #</span>
          <input className="input" name="brand_number" />
        </label>
        <label className="field">
          <span className="label">UPC</span>
          <input className="input" name="upc" />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>
        <label className="field">
          <span className="label">Retail price</span>
          <input className="input" name="retail_price" type="number" min="0" step="0.01" />
        </label>
        <label className="field">
          <span className="label">Wholesale price</span>
          <input className="input" name="wholesale_price" type="number" min="0" step="0.01" />
        </label>
      </div>

      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="checkbox" name="wholesale_excluded" /> Wholesale excluded
      </label>

      {message ? <p className="form-msg">{message}</p> : null}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Creating..." : "Create product"}
      </button>
    </form>
  );
}
