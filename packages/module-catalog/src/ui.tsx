import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type {
  AvailabilityMap,
  AvailabilityStatus,
  Category,
  Customer,
  CustomerTier,
  Location,
  Product,
  WholesalePriceMap,
} from "./index";
import { formatUsd, isWholesaleTier, resolvePrice, tierLabel } from "./pricing";

const mutedStyle: CSSProperties = {
  color: "var(--muted)",
};

function availabilityLabel(status?: AvailabilityStatus) {
  switch (status) {
    case "in_stock":
      return "In stock";
    case "low_stock":
      return "Low stock";
    default:
      return "Out of stock";
  }
}

function availabilityClass(status?: AvailabilityStatus) {
  switch (status) {
    case "in_stock":
      return "in-stock";
    case "low_stock":
      return "low-stock";
    default:
      return "out-stock";
  }
}

export function AvailabilityBadge({ status }: { status?: AvailabilityStatus }) {
  return <span className={`badge ${availabilityClass(status)}`}>{availabilityLabel(status)}</span>;
}

export function CategoryNav({
  categories,
  activeCategoryId,
}: {
  categories: Category[];
  activeCategoryId?: number;
}) {
  return (
    <nav aria-label="Catalog categories" className="cat-nav">
      <Link href="/catalog" className={`cat-link${!activeCategoryId ? " active" : ""}`}>
        All products
      </Link>
      {categories.map((category) => (
        <Link
          key={category.id}
          href={`/catalog?category=${category.id}`}
          className={`cat-link${activeCategoryId === category.id ? " active" : ""}`}
        >
          {category.name}
        </Link>
      ))}
    </nav>
  );
}

export function ProductCard({
  product,
  tier,
  wholesale,
  availability,
}: {
  product: Product;
  tier?: CustomerTier | null;
  wholesale?: number | null;
  availability?: AvailabilityStatus;
}) {
  const resolved = resolvePrice({
    tier,
    retail: product.retail_price,
    wholesale,
    wholesaleExcluded: product.wholesale_excluded,
  });
  const specs = [
    product.shot_count ? `${product.shot_count} shots` : null,
    product.gram_weight ? `${product.gram_weight}g` : null,
    product.sold_as,
  ].filter(Boolean);

  return (
    <Link href={`/product/${product.id}`} className="product-card">
      <div className="product-thumb">#{product.item_number}</div>

      <div>
        <h3>{product.name}</h3>
        {specs.length > 0 ? (
          <p style={{ ...mutedStyle, margin: "0.5rem 0 0", fontSize: "0.8125rem" }}>
            {specs.join(" - ")}
          </p>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: "0.5rem" }}>
        <AvailabilityBadge status={availability} />
        <div>
          <span className="price">{formatUsd(resolved.price, "Contact store")}</span>
          <span className="price-note">{resolved.label}</span>
        </div>
      </div>
    </Link>
  );
}

export interface CatalogViewProps {
  brandName?: string;
  categories: Category[];
  products: Product[];
  customer?: Customer | null;
  wholesalePrices?: WholesalePriceMap;
  availability?: AvailabilityMap;
  activeCategoryId?: number;
  setupRequired?: boolean;
}

export function CatalogView({
  brandName = "BananaFORCE",
  categories,
  products,
  customer,
  wholesalePrices = {},
  availability = {},
  activeCategoryId,
  setupRequired = false,
}: CatalogViewProps) {
  const activeCategory = categories.find((category) => category.id === activeCategoryId);
  const wholesaleActive = customer?.approved && isWholesaleTier(customer.tier);

  return (
    <div className="page">
      <main className="container">
        <header className="page-head">
          <span className="eyebrow">{brandName}</span>
          <h1>{activeCategory ? activeCategory.name : "Catalog"}</h1>
        </header>

        <div className="catalog-layout">
          <aside className="catalog-aside">
            <h2 className="eyebrow" style={{ margin: "0 0 0.625rem" }}>
              Categories
            </h2>
            <CategoryNav categories={categories} activeCategoryId={activeCategoryId} />
          </aside>

          <section>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                alignItems: "end",
                flexWrap: "wrap",
              }}
            >
              <p style={{ ...mutedStyle, margin: 0 }}>
                {products.length} item{products.length === 1 ? "" : "s"}
                {wholesaleActive ? ` - ${tierLabel(customer.tier)} pricing applied` : ""}
              </p>
            </div>

            {setupRequired ? (
              <SetupNotice message="Catalog is not configured. Contact your administrator." />
            ) : null}

            {products.length === 0 ? (
              <EmptyState
                title={setupRequired ? "Catalog data is not connected" : "No products to show"}
                body={
                  setupRequired
                    ? "Products will appear here after the catalog database is connected."
                    : "No active products matched this category."
                }
              />
            ) : (
              <div className="product-grid">
                {products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    tier={customer?.tier}
                    wholesale={wholesalePrices[product.id]}
                    availability={availability[product.id]}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export interface ProductDetailProps {
  product: Product | null;
  customer?: Customer | null;
  wholesalePrice?: number | null;
  availability?: AvailabilityStatus;
  locations?: Location[];
  setupRequired?: boolean;
  orderingSlot?: ReactNode;
}

export function ProductDetail({
  product,
  customer,
  wholesalePrice,
  availability,
  locations = [],
  setupRequired = false,
  orderingSlot,
}: ProductDetailProps) {
  if (!product) {
    return (
      <div className="page">
        <main className="container">
          <BackToCatalog />
          {setupRequired ? (
            <EmptyState
              title="Catalog setup required"
              body="Set Supabase environment variables and apply the catalog migration before product detail pages can load data."
            />
          ) : (
            <EmptyState title="Product unavailable" body="This product is not available." />
          )}
        </main>
      </div>
    );
  }

  const resolved = resolvePrice({
    tier: customer?.tier,
    retail: product.retail_price,
    wholesale: wholesalePrice,
    wholesaleExcluded: product.wholesale_excluded,
  });

  return (
    <div className="page">
      <main className="container">
        <BackToCatalog />

        <div className="product-detail">
          <div className="product-hero">#{product.item_number}</div>

          <section>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <AvailabilityBadge status={availability} />
              <h1 style={{ margin: 0, fontSize: "clamp(1.9rem, 4vw, 2.6rem)", lineHeight: 1.05, letterSpacing: "-0.025em", fontWeight: 600 }}>
                {product.name}
              </h1>
              <div>
                <span className="price" style={{ fontSize: "1.85rem" }}>
                  {formatUsd(resolved.price, "Contact store")}
                </span>
                <span className="price-note" style={{ fontSize: "0.95rem" }}>{resolved.label}</span>
              </div>
            </div>

            {product.description ? (
              <p style={{ margin: "1.25rem 0 0", lineHeight: 1.6 }}>{product.description}</p>
            ) : null}

            {isWholesaleTier(customer?.tier) && product.wholesale_excluded ? (
              <p className="callout tint" style={{ margin: "1.25rem 0 0" }}>
                This item is not available for wholesale pricing; retail pricing applies.
              </p>
            ) : null}

            <dl className="spec-grid">
              <Spec label="Item #" value={String(product.item_number)} />
              <Spec label="Sold as" value={product.sold_as} />
              <Spec label="Pack" value={product.pack} />
              <Spec
                label="Shots"
                value={product.shot_count ? String(product.shot_count) : null}
              />
              <Spec
                label="Gram weight"
                value={product.gram_weight ? `${product.gram_weight}g` : null}
              />
              <Spec label="Brand #" value={product.brand_number} />
            </dl>

            {orderingSlot ? <div style={{ marginTop: "1.75rem" }}>{orderingSlot}</div> : null}
          </section>
        </div>

        {locations.length > 0 ? <LocationList locations={locations} /> : null}
      </main>
    </div>
  );
}

function BackToCatalog() {
  return (
    <Link href="/catalog" className="back-link">
      Back to catalog
    </Link>
  );
}

function SetupNotice({ message }: { message: string }) {
  return (
    <p className="callout tint" style={{ marginTop: "1rem" }}>
      {message}
    </p>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty" style={{ marginTop: "1rem" }}>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div className="spec">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LocationList({ locations }: { locations: Location[] }) {
  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, letterSpacing: "-0.02em" }}>Locations</h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))",
          gap: "1rem",
          marginTop: "1rem",
        }}
      >
        {locations.map((location) => (
          <article key={location.id} className="panel pad" style={{ padding: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>{location.name}</h3>
            {[location.address, location.city, location.state, location.zip]
              .filter(Boolean)
              .join(", ") ? (
              <p style={{ ...mutedStyle, margin: "0.5rem 0 0" }}>
                {[location.address, location.city, location.state, location.zip]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            ) : null}
            {location.phone ? (
              <p style={{ ...mutedStyle, margin: "0.5rem 0 0" }}>{location.phone}</p>
            ) : null}
            {location.hours ? (
              <p style={{ ...mutedStyle, margin: "0.5rem 0 0" }}>{location.hours}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
