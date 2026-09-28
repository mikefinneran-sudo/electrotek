import assert from "node:assert/strict";
import { catalogStats, cellText, parseCatalog, toSql } from "./importer";
import type { CatalogImportTemplate } from "./types";

const template = {
  name: "synthetic",
  columns: {
    itemNumber: "Item #",
    name: "Item Name",
    pack: "Pack",
    soldAs: "Sold as",
    categorySortOrder: "Category",
    categoryMarker: "Cases",
    retailPrice: "Retail",
    wholesaleFlag: "Wholesale",
    brandNumber: "Brand #",
    vendor: "Vendor",
  },
  locations: [
    {
      slug: "test-shop",
      name: "Kid's Test Shop",
      address: null,
      city: "Auburn",
      state: "IN",
      zip: "46706",
      phone: null,
      hours: null,
      is_public: true,
      sort_order: 1,
    },
  ],
  isCategoryRow(row) {
    return cellText(row.get("categoryMarker")) === "cat";
  },
  wholesaleExcluded(row) {
    return cellText(row.get("wholesaleFlag"))?.toUpperCase() === "NO";
  },
  attributeRegexes: {
    shotCount: /(\d+)\s*shots?/i,
    gramWeight: /(\d+)\s*g(?:r|ram|m)\b/i,
  },
} satisfies CatalogImportTemplate;

const rows: unknown[][] = [
  ["Vendor", "Retail", "Item Name", "Cases", "Item #", "Category", "Pack", "Sold as", "Wholesale", "Brand #"],
  [null, null, "Aerials", "cat", 10, 1.5, null, null, null, null],
  ["Black Cat", 0, "Kid's 12 shots 500 Gram", null, 901, null, "1/1", "Case", "NO", "B-1"],
  ["TNT", 1.5, "Duplicate ignored", null, "901", null, null, null, null, null],
  [null, null, "Fountains", "cat", 20, 2.5, null, null, null, null],
  ["TNT", 9.99, "200gm Fountain", null, 101, null, "12/1", "Piece", "", 12345],
  [
    0,
    4.25,
    { richText: [{ text: "Rich Text " }, { text: "6 shots 200g" }] },
    null,
    102,
    null,
    0,
    "Piece",
    null,
    0,
  ],
  [null, null, null, null, null, null, null, null, null, null],
  [null, null, "No item number", null, null, null, null, null, null, null],
  ["Bad Vendor", 3, "Bad item number", null, "not-a-number", null, null, null, null, null],
];

const parsed = parseCatalog(rows, template);

assert.deepEqual(
  parsed.categories,
  [
    { id: 10, name: "Aerials", sort_order: 1.5 },
    { id: 20, name: "Fountains", sort_order: 2.5 },
  ],
  "category headers are parsed from the item/name/sort columns",
);

assert.deepEqual(
  parsed.vendors,
  [
    { id: 1, name: "Black Cat" },
    { id: 2, name: "TNT" },
  ],
  "vendors are assigned ids by first-seen order and deduped by name",
);

assert.equal(parsed.products.length, 3, "duplicate products are dropped");
assert.equal(parsed.products[0]?.item_number, 901, "first duplicate product wins");
assert.equal(parsed.products[0]?.name, "Kid's 12 shots 500 Gram", "product names are trimmed and preserved");
assert.equal(parsed.products[0]?.category_id, 10, "products use the most recently seen category");
assert.equal(parsed.products[0]?.vendor_id, 1, "product stores the first-seen vendor id");
assert.equal(parsed.products[0]?.retail_price, 0, "zero numeric values are not coerced to null");
assert.deepEqual(
  parsed.products[0]?.attributes,
  { shot_count: 12, gram_weight: 500 },
  "attribute regexes populate the product attributes map",
);
assert.equal(parsed.products[0]?.shot_count, 12, "shot count is parsed from the name");
assert.equal(parsed.products[0]?.gram_weight, 500, "gram weight is parsed from the name");
assert.equal(parsed.products[0]?.wholesale_excluded, true, "NO wholesale flag excludes wholesale");
assert.equal(parsed.products[1]?.category_id, 20, "category assignment is positional, not item-prefix based");
assert.equal(parsed.products[1]?.brand_number, "12345", "numeric brand numbers are kept as text");
assert.equal(parsed.products[2]?.name, "Rich Text 6 shots 200g", "rich text cell values are coerced");
assert.equal(parsed.products[2]?.pack, null, "numeric 0 in a text/code column is the empty sentinel");
assert.equal(parsed.products[2]?.vendor_id, null, "numeric 0 vendor cell creates no vendor and leaves vendor_id null");
assert.equal(parsed.products[2]?.brand_number, null, "numeric 0 brand # is treated as empty");
assert.equal(parsed.products[2]?.gram_weight, null, "the copied Python gram regex does not match bare g");

assert.deepEqual(
  catalogStats(parsed),
  {
    sourceRows: 9,
    skippedRows: 3,
    duplicateProducts: 1,
    categories: 2,
    vendors: 2,
    products: 3,
    locations: 1,
    productsWithShotCount: 2,
    productsWithGramWeight: 2,
    wholesaleExcluded: 1,
  },
  "stats include import counts and parser outcomes",
);

const sql = toSql(parsed);
assert.match(sql, /insert into locations \(slug, name, address, city, state, zip, phone, hours, is_public, sort_order\) values/);
assert.match(sql, /insert into products \(item_number, name, category_id, vendor_id, brand_number, pack, sold_as, retail_price, attributes, shot_count, gram_weight, wholesale_excluded, is_active\) values/);
assert.match(sql, /'\{"shot_count":12,"gram_weight":500\}'::jsonb/, "SQL writes parsed attributes as jsonb");
assert.match(sql, /Kid''s 12 shots 500 Gram/, "SQL strings escape single quotes");
assert.match(sql, /on conflict \(item_number\) do nothing;/);
assert.match(sql, /insert into vendors \(name\) values/, "vendors are seeded by name only (serial id is auto-assigned)");
assert.match(sql, /on conflict \(name\) do nothing;/, "vendors dedup by name");
assert.match(sql, /on conflict \(id\) do nothing;/, "categories dedup by their stable sheet id");
assert.match(
  sql,
  /\(select id from vendors where name = 'Black Cat'\)/,
  "product vendor_id resolves the serial id by name via subselect",
);
assert.doesNotMatch(sql, /insert into vendors \(id, name\)/, "no explicit serial vendor ids are emitted");
assert.doesNotMatch(sql, /product_wholesale_prices|inventory/, "unused catalog tables are not emitted");

// Edge cases that bypass the count-parity check: a formula cell whose cached
// result is 0, and a boolean false, must both be treated as the empty sentinel
// in optional text/code columns (matching the Python `if cell` guard).
const edgeRows: unknown[][] = [
  ["Vendor", "Retail", "Item Name", "Cases", "Item #", "Category", "Pack", "Sold as", "Wholesale", "Brand #"],
  [{ formula: "=A1", result: 0 }, 0.1 + 0.2, "Formula zero vendor", null, 555, null, false, "Box", null, false],
];
const edge = parseCatalog(edgeRows, template);
assert.equal(edge.vendors.length, 0, "a formula cell resolving to 0 creates no vendor");
assert.equal(edge.products[0]?.vendor_id, null, "formula-zero vendor leaves vendor_id null");
assert.equal(edge.products[0]?.pack, null, "boolean false in a code column is the empty sentinel");
assert.equal(edge.products[0]?.brand_number, null, "boolean false brand # is the empty sentinel");
assert.match(toSql(edge), /, 0\.30,/, "retail_price is rounded to numeric(10,2) cents (no binary float noise)");

assert.throws(
  () =>
    parseCatalog(
      [["Item #", "Item Name"]],
      {
        ...template,
        columns: {
          ...template.columns,
          vendor: "Missing Vendor Header",
        },
      },
    ),
  /Missing mapped catalog import column/,
  "missing mapped headers produce a direct error",
);

console.log("catalog importer tests passed");
