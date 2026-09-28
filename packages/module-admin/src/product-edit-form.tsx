"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { PromoType } from "@waltersignal/bananaforce-module-catalog";
import { updateProductAction, uploadProductImage } from "./actions";

export type ProductEditData = {
  id: number;
  item_number: number;
  name: string;
  pack: string | null;
  sold_as: string | null;
  retail_price: number | null;
  unit_price: number | null;
  promo_type: PromoType | null;
  deal_qty: number | null;
  deal_price: number | null;
  wholesale_excluded: boolean;
  is_active: boolean;
  is_featured: boolean;
  description: string | null;
  image_url: string | null;
  upc: string | null;
  wholesale_price: number | null;
};

export function ProductEditForm({ product }: { product: ProductEditData }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(product.image_url);
  const [pending, startTransition] = useTransition();
  const [uploadPending, startUpload] = useTransition();

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProductAction(fd);
      setMessage(result.message ?? (result.ok ? "Saved." : "Could not save."));
    });
  }

  function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startUpload(async () => {
      const result = await uploadProductImage(fd);
      setMessage(result.message ?? (result.ok ? "Uploaded." : "Upload failed."));
      if (result.ok && result.image_url) {
        setImageUrl(result.image_url);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  return (
    <div className="product-detail" style={{ marginTop: "1.5rem" }}>
      <div className="panel pad">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={product.name} className="product-hero" style={{ objectFit: "contain" }} />
        ) : (
          <div className="product-hero">#{product.item_number}</div>
        )}
        <form onSubmit={handleUpload} className="form" style={{ marginTop: "1rem" }}>
          <input type="hidden" name="productId" value={product.id} />
          <input ref={fileRef} name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
          <button type="submit" className="btn block" disabled={uploadPending}>
            {uploadPending ? "Uploading…" : "Upload photo"}
          </button>
        </form>
      </div>

      <form onSubmit={handleSave} className="panel pad form">
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="image_url" value={imageUrl ?? ""} />
        <Link href="/admin/inventory" className="back-link">
          ← Inventory
        </Link>
        <label className="field">
          <span className="label">Name</span>
          <input className="input" name="name" required defaultValue={product.name} />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <label className="field">
            <span className="label">Retail price</span>
            <input className="input" name="retail_price" type="number" step="0.01" defaultValue={product.retail_price ?? ""} />
          </label>
          <label className="field">
            <span className="label">Wholesale price</span>
            <input className="input" name="wholesale_price" type="number" step="0.01" defaultValue={product.wholesale_price ?? ""} />
          </label>
        </div>
        <label className="field">
          <span className="label">Promo type</span>
          <select className="input" name="promo_type" defaultValue={product.promo_type ?? ""}>
            <option value="">None</option>
            <option value="bogo">BOGO</option>
            <option value="volume">Volume deal</option>
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
          <label className="field">
            <span className="label">Unit price</span>
            <input className="input" name="unit_price" type="number" step="0.01" defaultValue={product.unit_price ?? ""} />
          </label>
          <label className="field">
            <span className="label">Deal qty</span>
            <input className="input" name="deal_qty" type="number" defaultValue={product.deal_qty ?? ""} />
          </label>
          <label className="field">
            <span className="label">Deal price</span>
            <input className="input" name="deal_price" type="number" step="0.01" defaultValue={product.deal_price ?? ""} />
          </label>
        </div>
        <label className="field">
          <span className="label">Description</span>
          <textarea className="input" name="description" rows={4} defaultValue={product.description ?? ""} />
        </label>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <label>
            <input type="checkbox" name="is_active" defaultChecked={product.is_active} /> Active
          </label>
          <label>
            <input type="checkbox" name="is_featured" defaultChecked={product.is_featured} /> Featured
          </label>
          <label>
            <input type="checkbox" name="wholesale_excluded" defaultChecked={product.wholesale_excluded} /> Wholesale excluded
          </label>
        </div>
        {message ? <p className="form-msg">{message}</p> : null}
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Saving…" : "Save product"}
        </button>
      </form>
    </div>
  );
}
