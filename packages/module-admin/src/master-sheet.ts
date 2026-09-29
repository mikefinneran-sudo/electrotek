import {
  cellInteger,
  cellNumber,
  cellText,
  parseCatalog,
} from "@waltersignal/bananaforce-catalog-import";
import { readCsvRows } from "@waltersignal/bananaforce-catalog-import/io";
import type {
  CatalogImportTemplate,
  ParsedCatalog,
} from "@waltersignal/bananaforce-catalog-import/types";

export const MASTER_SHEET_HEADERS: readonly string[] = [
  "Row Type",
  "Item #",
  "Item Name",
  "Category",
  "Pack",
  "Sold as",
  "Retail",
  "Wholesale Price",
  "Wholesale Excluded",
  "Brand #",
  "UPC",
  "Vendor",
  "On Hand",
];

export const MASTER_SHEET_TEMPLATE: CatalogImportTemplate = {
  name: "bananaforce-master-sheet",
  columns: {
    rowType: "Row Type",
    itemNumber: "Item #",
    name: "Item Name",
    categorySortOrder: "Category",
    pack: "Pack",
    soldAs: "Sold as",
    retailPrice: "Retail",
    wholesalePrice: "Wholesale Price",
    wholesaleFlag: "Wholesale Excluded",
    brandNumber: "Brand #",
    upc: "UPC",
    vendor: "Vendor",
    onHand: "On Hand",
  },
  isCategoryRow(row) {
    return row.text("rowType") === "category";
  },
  wholesaleExcluded(row) {
    const value = row.text("wholesaleFlag")?.toLowerCase();
    return value === "yes" || value === "true" || value === "1" || value === "on";
  },
};

export type MasterSheetCategoryRow = {
  category_id: number;
  name: string;
  sort_order: number;
};

export type MasterSheetProductRow = {
  id?: number;
  item_number: number;
  name: string;
  category_id: number | null;
  pack: string | null;
  sold_as: string | null;
  retail_price: number | null;
  wholesale_price: number | null;
  wholesale_excluded: boolean;
  brand_number: string | null;
  upc: string | null;
  vendor_name: string | null;
  on_hand: number | null;
};

/**
 * Ordered cell matrix for the master sheet: header row, then each category
 * followed by its products (item-number ascending), then any uncategorized
 * products. Cells keep their native types — numbers stay numbers — so the
 * xlsx and PDF renderers get real values, not pre-stringified CSV text.
 */
export function buildMasterSheetMatrix(input: {
  categories: MasterSheetCategoryRow[];
  products: MasterSheetProductRow[];
}): readonly unknown[][] {
  const categories = [...input.categories].sort(
    (a, b) => a.sort_order - b.sort_order || a.category_id - b.category_id,
  );
  const categoryIds = new Set(categories.map((category) => category.category_id));
  const out: unknown[][] = [[...MASTER_SHEET_HEADERS]];

  for (const category of categories) {
    out.push([...categoryCells(category)]);

    const products = input.products
      .filter((product) => product.category_id === category.category_id)
      .sort((a, b) => a.item_number - b.item_number);

    for (const product of products) {
      out.push([...productCells(product)]);
    }
  }

  const uncategorized = input.products
    .filter((product) => product.category_id == null || !categoryIds.has(product.category_id))
    .sort((a, b) => a.item_number - b.item_number);

  for (const product of uncategorized) {
    out.push([...productCells(product)]);
  }

  return out;
}

export function buildMasterSheetCsv(input: {
  categories: MasterSheetCategoryRow[];
  products: MasterSheetProductRow[];
}): string {
  return `${buildMasterSheetMatrix(input).map(csvLine).join("\n")}\n`;
}

export function parseMasterSheetCsv(text: string): {
  catalog: ParsedCatalog;
  extrasByItemNumber: Map<
    number,
    {
      wholesale_price: number | null;
      wholesale_price_clear: boolean;
      upc: string | null;
      on_hand: number | null;
    }
  >;
  errors: string[];
} {
  return parseMasterSheetRows(readCsvRows(text));
}

export function parseMasterSheetRows(rows: unknown[][]): {
  catalog: ParsedCatalog;
  extrasByItemNumber: Map<
    number,
    {
      wholesale_price: number | null;
      wholesale_price_clear: boolean;
      upc: string | null;
      on_hand: number | null;
    }
  >;
  errors: string[];
} {
  let catalog: ParsedCatalog;

  try {
    catalog = parseCatalog(rows, MASTER_SHEET_TEMPLATE);
  } catch (error) {
    return {
      catalog: emptyParsedCatalog(rows.length),
      extrasByItemNumber: new Map(),
      errors: [error instanceof Error ? error.message : "Could not parse master sheet."],
    };
  }

  const headerRowIndex = MASTER_SHEET_TEMPLATE.headerRowIndex ?? 0;
  const headerRow = rows[headerRowIndex] ?? [];
  const indexes = headerIndexes(headerRow);
  const rowTypeIndex = indexes.get(normalizeHeader("Row Type"));
  const itemIndex = indexes.get(normalizeHeader("Item #"));
  const categoryIndex = indexes.get(normalizeHeader("Category"));
  const wholesaleIndex = indexes.get(normalizeHeader("Wholesale Price"));
  const upcIndex = indexes.get(normalizeHeader("UPC"));
  const onHandIndex = indexes.get(normalizeHeader("On Hand"));
  const productItemNumbers = new Set(catalog.products.map((product) => product.item_number));
  const explicitCategoryByItemNumber = new Map<number, number | null>();
  const extrasByItemNumber = new Map<
    number,
    {
      wholesale_price: number | null;
      wholesale_price_clear: boolean;
      upc: string | null;
      on_hand: number | null;
    }
  >();
  const errors: string[] = [];

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowType = rowTypeIndex == null ? null : cellText(row[rowTypeIndex]);
    if (rowType === "category") continue;

    const itemNumber = itemIndex == null ? null : cellInteger(row[itemIndex]);
    if (itemNumber == null || !productItemNumbers.has(itemNumber)) continue;
    if (extrasByItemNumber.has(itemNumber)) continue;

    const lineNo = index + 1;
    if (rowType === "product") {
      const categoryCell = categoryIndex == null ? null : row[categoryIndex];
      const categoryRaw = cellText(categoryCell);
      if (categoryRaw == null) {
        explicitCategoryByItemNumber.set(itemNumber, null);
      } else {
        const categoryId = cellInteger(categoryCell);
        if (categoryId == null || categoryId < 0) {
          errors.push(`Line ${lineNo}: invalid Category.`);
        } else {
          explicitCategoryByItemNumber.set(itemNumber, categoryId);
        }
      }
    }

    const wholesaleCell = wholesaleIndex == null ? null : row[wholesaleIndex];
    const wholesaleRaw = cellText(wholesaleCell);
    let wholesale_price: number | null = null;
    // Default false: a blank Wholesale Price cell means "leave unchanged", NOT
    // "delete". Clearing a wholesale price is intentional only — enter an
    // explicit 0 (handled as a clear in importMasterSheet). This prevents silent
    // data loss when a hand-edited sheet blanks the column.
    let wholesale_price_clear = false;

    if (wholesaleRaw != null) {
      const value = cellNumber(wholesaleCell);
      if (value == null || !Number.isFinite(value) || value < 0) {
        errors.push(`Line ${lineNo}: invalid Wholesale Price.`);
        wholesale_price_clear = false;
      } else {
        wholesale_price = value;
        wholesale_price_clear = false;
      }
    }

    const onHandCell = onHandIndex == null ? null : row[onHandIndex];
    const onHandRaw = cellText(onHandCell);
    let on_hand: number | null = null;

    if (onHandRaw != null) {
      const value = cellNumber(onHandCell);
      if (value == null || !Number.isFinite(value) || value < 0) {
        errors.push(`Line ${lineNo}: invalid On Hand.`);
      } else {
        on_hand = value;
      }
    }

    extrasByItemNumber.set(itemNumber, {
      wholesale_price,
      wholesale_price_clear,
      upc: upcIndex == null ? null : cellText(row[upcIndex]),
      on_hand,
    });
  }

  if (explicitCategoryByItemNumber.size > 0) {
    catalog = {
      ...catalog,
      products: catalog.products.map((product) =>
        explicitCategoryByItemNumber.has(product.item_number)
          ? {
              ...product,
              category_id: explicitCategoryByItemNumber.get(product.item_number) ?? null,
            }
          : product,
      ),
    };
  }

  return { catalog, extrasByItemNumber, errors };
}

function categoryCells(row: MasterSheetCategoryRow): readonly unknown[] {
  return [
    "category",
    row.category_id,
    row.name,
    row.sort_order,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

function productCells(row: MasterSheetProductRow): readonly unknown[] {
  return [
    "product",
    row.item_number,
    row.name,
    row.category_id,
    row.pack,
    row.sold_as,
    row.retail_price,
    row.wholesale_price,
    row.wholesale_excluded ? "YES" : "",
    row.brand_number,
    row.upc,
    row.vendor_name,
    row.on_hand,
  ];
}

function csvLine(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

function csvCell(value: unknown): string {
  if (value == null || value === "") return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function headerIndexes(headers: readonly unknown[]): Map<string, number> {
  const indexes = new Map<string, number>();

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized && !indexes.has(normalized)) {
      indexes.set(normalized, index);
    }
  });

  return indexes;
}

function normalizeHeader(value: unknown): string {
  return cellText(value)?.toLowerCase().replace(/\s+/g, " ") ?? "";
}

function emptyParsedCatalog(sourceRows: number): ParsedCatalog {
  return {
    templateName: MASTER_SHEET_TEMPLATE.name,
    categories: [],
    vendors: [],
    products: [],
    locations: [],
    parseStats: {
      sourceRows: Math.max(0, sourceRows - 1),
      skippedRows: 0,
      duplicateProducts: 0,
    },
  };
}
