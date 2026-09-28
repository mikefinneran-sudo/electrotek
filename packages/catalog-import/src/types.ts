export type CellValue = unknown;

export type CatalogRows = readonly (readonly CellValue[])[];

export interface ColumnMap {
  itemNumber: string;
  name: string;
  categorySortOrder?: string;
  pack?: string;
  soldAs?: string;
  retailPrice?: string;
  wholesaleFlag?: string;
  brandNumber?: string;
  vendor?: string;
  [columnKey: string]: string | undefined;
}

export interface RowReader {
  raw: readonly CellValue[];
  get(columnKey: string): CellValue;
  text(columnKey: string): string | null;
  number(columnKey: string): number | null;
  integer(columnKey: string): number | null;
}

export interface AttributeRegexes extends Record<string, RegExp | undefined> {
  shotCount?: RegExp;
  gramWeight?: RegExp;
}

export interface CatalogImportTemplate {
  name: string;
  sheetName?: string;
  headerRowIndex?: number;
  columns: ColumnMap;
  locations?: readonly ParsedLocation[];
  isCategoryRow: (row: RowReader) => boolean;
  wholesaleExcluded?: (row: RowReader) => boolean;
  attributeRegexes?: AttributeRegexes;
}

export interface ParsedCategory {
  id: number;
  name: string;
  sort_order: number;
}

export interface ParsedVendor {
  id: number;
  name: string;
}

export interface ParsedLocation {
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  hours: string | null;
  is_public: boolean;
  sort_order: number;
}

export interface ParsedProduct {
  item_number: number;
  name: string;
  category_id: number | null;
  vendor_id: number | null;
  brand_number: string | null;
  pack: string | null;
  sold_as: string | null;
  retail_price: number | null;
  attributes: Record<string, number>;
  shot_count: number | null;
  gram_weight: number | null;
  wholesale_excluded: boolean;
  is_active: boolean;
}

export interface CatalogParseStats {
  sourceRows: number;
  skippedRows: number;
  duplicateProducts: number;
}

export interface ParsedCatalog {
  templateName: string;
  categories: ParsedCategory[];
  vendors: ParsedVendor[];
  products: ParsedProduct[];
  locations: ParsedLocation[];
  parseStats: CatalogParseStats;
}

export interface CatalogImportStats extends CatalogParseStats {
  categories: number;
  vendors: number;
  products: number;
  locations: number;
  productsWithShotCount: number;
  productsWithGramWeight: number;
  wholesaleExcluded: number;
}
