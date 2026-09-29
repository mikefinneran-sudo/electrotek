import assert from "node:assert/strict";
import { readCsvRows } from "@waltersignal/bananaforce-catalog-import/io";
import {
  MASTER_SHEET_HEADERS,
  buildMasterSheetCsv,
  buildMasterSheetMatrix,
  parseMasterSheetCsv,
  parseMasterSheetRows,
} from "./master-sheet";

const csv = buildMasterSheetCsv({
  categories: [
    { category_id: 20, name: "Fountains", sort_order: 2 },
    { category_id: 10, name: "Aerials", sort_order: 1 },
  ],
  products: [
    {
      id: 1001,
      item_number: 501,
      name: "Sky Burst",
      category_id: 10,
      pack: "12/1",
      sold_as: "Each",
      retail_price: 49.99,
      wholesale_price: 31.5,
      wholesale_excluded: true,
      brand_number: "BR-501",
      upc: "000111222333",
      vendor_name: "Walter Vendor",
      on_hand: 18,
    },
    {
      item_number: 777,
      name: "Loose Novelty",
      category_id: null,
      pack: null,
      sold_as: null,
      retail_price: null,
      wholesale_price: null,
      wholesale_excluded: false,
      brand_number: null,
      upc: null,
      vendor_name: null,
      on_hand: null,
    },
  ],
});

const rows = readCsvRows(csv);
assert.deepEqual(rows[0], MASTER_SHEET_HEADERS, "headers use the canonical master-sheet order");
assert.equal(rows[1]?.[0], "category", "category rows use Row Type = category");
assert.equal(rows[1]?.[1], "10", "category Item # stores the category id");
assert.equal(rows[1]?.[2], "Aerials", "category Item Name stores the category name");
assert.equal(rows[1]?.[3], "1", "category Category stores sort_order");
assert.equal(rows[2]?.[0], "product", "product rows use the explicit product Row Type");
assert.equal(rows[2]?.[3], "10", "product Category stores the category id");
assert.equal(rows[2]?.[8], "YES", "wholesale exclusion is exported as YES");
assert.equal(rows[4]?.[0], "product", "uncategorized rows are still product rows");
assert.equal(rows[4]?.[3], "", "uncategorized product Category stays blank");

const parsed = parseMasterSheetCsv(csv);
assert.deepEqual(
  parsed.catalog.categories,
  [
    { id: 10, name: "Aerials", sort_order: 1 },
    { id: 20, name: "Fountains", sort_order: 2 },
  ],
  "category header rows round-trip through the catalog parser",
);
assert.equal(parsed.catalog.products.length, 2, "all product rows round-trip");

const skyBurst = parsed.catalog.products.find((product) => product.item_number === 501);
assert.ok(skyBurst, "Sky Burst product parsed");
assert.equal(skyBurst.category_id, 10, "product remains grouped under its category header");
assert.equal(skyBurst.wholesale_excluded, true, "YES maps to wholesale_excluded");
assert.equal(skyBurst.vendor_id, 1, "vendor is parsed and linked by first-seen id");
assert.deepEqual(parsed.catalog.vendors, [{ id: 1, name: "Walter Vendor" }], "vendor names round-trip");

const extras = parsed.extrasByItemNumber.get(501);
assert.ok(extras, "extras map contains the product item number");
assert.equal(extras.wholesale_price, 31.5, "Wholesale Price is preserved for the side table");
assert.equal(extras.wholesale_price_clear, false, "non-empty Wholesale Price is not a clear");
assert.equal(extras.upc, "000111222333", "UPC is preserved");
assert.equal(extras.on_hand, 18, "On Hand is preserved");

const uncategorized = parsed.catalog.products.find((product) => product.item_number === 777);
assert.ok(uncategorized, "uncategorized product parsed");
assert.equal(uncategorized.category_id, null, "uncategorized products stay after category sections");

assert.deepEqual(parsed.errors, [], "round-trip parse has no errors");

// A blank Wholesale Price must NOT request a clear (avoids silent data loss),
// and a blank On Hand must parse as null — distinct from a real zero.
const novelty = parsed.extrasByItemNumber.get(777);
assert.ok(novelty, "blank-extras product parsed");
assert.equal(novelty.wholesale_price, null, "blank Wholesale Price parses as null");
assert.equal(novelty.wholesale_price_clear, false, "blank Wholesale Price does NOT request a clear");
assert.equal(novelty.on_hand, null, "blank On Hand parses as null, not 0");

// Explicit 0 is intentional: 0 Wholesale Price clears the side-table price, and
// 0 On Hand is a real stocked-zero distinct from "no inventory row".
function makeRow(values: Record<string, string>): string[] {
  const row: string[] = new Array(MASTER_SHEET_HEADERS.length).fill("");
  for (const [name, value] of Object.entries(values)) {
    row[MASTER_SHEET_HEADERS.indexOf(name)] = value;
  }
  return row;
}
const explicit = parseMasterSheetRows([
  [...MASTER_SHEET_HEADERS],
  makeRow({ "Row Type": "product", "Item #": "900", "Item Name": "Zero Clear", "Wholesale Price": "0", "On Hand": "0" }),
  makeRow({ "Row Type": "product", "Item #": "901", "Item Name": "Bad Numbers", "Wholesale Price": "-5", "On Hand": "lots" }),
]);
const zeroClear = explicit.extrasByItemNumber.get(900);
assert.ok(zeroClear, "explicit-zero product parsed");
assert.equal(zeroClear.wholesale_price, 0, "explicit 0 Wholesale Price parses as 0 (clears in import)");
assert.equal(zeroClear.wholesale_price_clear, false, "explicit 0 is a value, not the blank-clear flag");
assert.equal(zeroClear.on_hand, 0, "explicit 0 On Hand parses as 0, distinct from null");
const bad = explicit.extrasByItemNumber.get(901);
assert.ok(bad, "malformed-number product still parsed");
assert.equal(bad.wholesale_price, null, "negative Wholesale Price does not set a price");
assert.equal(bad.on_hand, null, "non-numeric On Hand does not set a qty");
assert.ok(
  explicit.errors.some((e) => e.includes("Wholesale Price")),
  "negative Wholesale Price reported as an error",
);
assert.ok(
  explicit.errors.some((e) => e.includes("On Hand")),
  "non-numeric On Hand reported as an error",
);


// --- Row ordering ---------------------------------------------------------
// The export is grouped: header, then each category (sort_order ascending)
// immediately followed by its own products (item number ascending), then any
// uncategorized products last. Round-trip parsing does not check order, so
// without this the grouping could invert unnoticed.
const ordered = buildMasterSheetMatrix({
  categories: [
    { category_id: 20, name: "Fountains", sort_order: 2 },
    { category_id: 10, name: "Aerials", sort_order: 1 },
  ],
  products: [
    orderingProduct(300, 20),
    orderingProduct(200, 10),
    orderingProduct(900, null),
    orderingProduct(100, 10),
  ],
});

assert.deepEqual(
  ordered.map((row) => [row[0], row[1]]),
  [
    ["Row Type", "Item #"],
    ["category", 10],
    ["product", 100],
    ["product", 200],
    ["category", 20],
    ["product", 300],
    ["product", 900],
  ],
  "matrix groups products under their category by sort_order, item number ascending, uncategorized last",
);

assert.deepEqual(
  buildMasterSheetCsv({
    categories: [{ category_id: 10, name: "Aerials", sort_order: 1 }],
    products: [orderingProduct(200, 10), orderingProduct(100, 10)],
  })
    .trimEnd()
    .split("\n")
    .map((line) => line.split(",")[1]),
  ["Item #", "10", "100", "200"],
  "csv renders the same ordering as the matrix",
);

function orderingProduct(item_number: number, category_id: number | null) {
  return {
    item_number,
    category_id,
    name: `Item ${item_number}`,
    pack: null,
    sold_as: null,
    retail_price: null,
    wholesale_price: null,
    wholesale_excluded: false,
    brand_number: null,
    upc: null,
    vendor_name: null,
    on_hand: null,
  };
}

console.log("module-admin master sheet tests passed");
