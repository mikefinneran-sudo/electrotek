# BananaFORCE Catalog Import

Generic spreadsheet-to-catalog importer for BananaFORCE client deploys.

The importer reads an `.xlsx` sheet, applies a declarative **client-owned**
template, and emits Supabase seed SQL for:

- `locations`
- `categories`
- `vendors`
- `products`

It intentionally does not emit `product_wholesale_prices` or `inventory`. The Freebies sheet only contains a wholesale exclusion flag, not wholesale dollar prices, and the known-good seed does not carry inventory quantities.

This package stays generic: it contains **no** client-specific data. Each
client's template lives in client-owned config (e.g.
`clients/<client>/catalog-template.ts`) and is passed to the CLI by path.

## Run the Freebies Import

After installing dependencies:

```bash
pnpm --filter @waltersignal/bananaforce-catalog-import exec tsx src/cli.ts \
  "$HOME/Downloads/spreadsheet for Mike F for website info.xlsx" \
  --template ../../clients/freebies/catalog-template.ts \
  --out /tmp/freebies_catalog.sql
```

(Invoke the CLI via `exec tsx src/cli.ts`. `pnpm exec` links dependency bins —
including `tsx` — onto PATH, but not the workspace package's own `bin`, so the
bare `bananaforce-catalog-import` name is not runnable from the workspace. Do
not add an `import` script: `pnpm import` is a reserved pnpm built-in. The
`--template` path is resolved relative to the current working directory; the
example above assumes the package directory.)

Expected Freebies shape:

- 24 categories
- 23 vendors
- 425 products
- 2 locations

The CLI also reports parsed shot count, gram weight, wholesale exclusion, skipped-row, and duplicate-product stats.

## Add a Client Template

Create `clients/<client>/catalog-template.ts` and **default-export** a
`CatalogImportTemplate` (import the type from
`@waltersignal/bananaforce-catalog-import/types` — a type-only import, erased at
runtime, so the file has no runtime dependency on this package).

The template owns all client-specific behavior:

- sheet name
- column header names
- static locations
- category-row detection
- wholesale exclusion mapping
- product-name attribute regexes

The core importer maps columns by header name, not by index, and assigns product categories by the most recently seen category header row.

Pass the template to the CLI by path: `--template clients/<client>/catalog-template.ts`. No package change is needed to onboard a new client.

## Package Scripts

```bash
pnpm --filter @waltersignal/bananaforce-catalog-import typecheck
pnpm --filter @waltersignal/bananaforce-catalog-import test
```
