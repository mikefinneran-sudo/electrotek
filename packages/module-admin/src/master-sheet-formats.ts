// Pure renderers — no secrets, no DB. Mirrors module-quote-engine/src/pdf.ts,
// which is likewise server-side-only by virtue of who imports it, so these stay
// testable outside a Next server context.
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  MASTER_SHEET_HEADERS,
  buildMasterSheetMatrix,
  type MasterSheetCategoryRow,
  type MasterSheetProductRow,
} from "./master-sheet";

export interface MasterSheetInput {
  categories: MasterSheetCategoryRow[];
  products: MasterSheetProductRow[];
}

export interface MasterSheetMeta {
  /** Client brand name, printed on the PDF cover line. */
  brandName: string;
  /** Human name of the stock location the On Hand column reflects. */
  locationName: string;
  /** Export date, already formatted for display. */
  stamp: string;
}

export type MasterSheetFormat = "csv" | "xlsx" | "pdf";

export function isMasterSheetFormat(value: string | null): value is MasterSheetFormat {
  return value === "csv" || value === "xlsx" || value === "pdf";
}

export const MASTER_SHEET_CONTENT_TYPE: Record<MasterSheetFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/**
 * Full-fidelity workbook: every master-sheet column, same row grouping and
 * ordering as the CSV, so a round trip through Excel or Google Sheets still
 * re-imports. Numbers are written as numbers (not text) so the sheet is
 * immediately sortable and summable; blank stays blank, because an empty
 * On Hand cell means "no inventory row here" and must not become a 0.
 */
export async function buildMasterSheetWorkbook(input: MasterSheetInput): Promise<Buffer> {
  const matrix = buildMasterSheetMatrix(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BananaFORCE";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Master Sheet", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  for (const row of matrix) {
    sheet.addRow(row.map((cell) => (cell === "" ? null : cell)));
  }

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };

  // Category rows are structural, not data — shade them so a human scanning the
  // sheet sees the grouping the CSV only implies by position.
  sheet.eachRow((row: ExcelJS.Row, rowNumber: number) => {
    if (rowNumber === 1) return;
    if (row.getCell(1).value !== "category") return;
    row.font = { bold: true };
    row.eachCell({ includeEmpty: true }, (cell: ExcelJS.Cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3F6" } };
    });
  });

  const retailColumn = MASTER_SHEET_HEADERS.indexOf("Retail") + 1;
  const wholesaleColumn = MASTER_SHEET_HEADERS.indexOf("Wholesale Price") + 1;
  for (const columnIndex of [retailColumn, wholesaleColumn]) {
    if (columnIndex > 0) sheet.getColumn(columnIndex).numFmt = '#,##0.00;[Red]-#,##0.00';
  }

  // UPCs are digit strings with meaningful leading zeroes. Excel will happily
  // turn "012345678905" into 12345678905 on open, so force the column to text.
  const upcColumn = MASTER_SHEET_HEADERS.indexOf("UPC") + 1;
  if (upcColumn > 0) sheet.getColumn(upcColumn).numFmt = "@";

  for (let index = 0; index < MASTER_SHEET_HEADERS.length; index += 1) {
    const column = sheet.getColumn(index + 1);
    let widest = (MASTER_SHEET_HEADERS[index] ?? "").length;
    column.eachCell({ includeEmpty: false }, (cell: ExcelJS.Cell) => {
      widest = Math.max(widest, String(cell.value ?? "").length);
    });
    column.width = Math.min(Math.max(widest + 2, 8), 42);
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: MASTER_SHEET_HEADERS.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// --- PDF ------------------------------------------------------------------
// The PDF is a hard copy — something to carry down an aisle and write on — not
// a re-importable record. It prints the columns a person needs in hand and
// leaves the import-only bookkeeping columns (category id, wholesale pricing,
// exclusion flags) to the CSV and workbook.

const PDF_COLUMNS = [
  { header: "Item #", source: "Item #", width: 52, align: "left" },
  { header: "Item Name", source: "Item Name", width: 188, align: "left" },
  { header: "Pack", source: "Pack", width: 52, align: "left" },
  { header: "Sold as", source: "Sold as", width: 58, align: "left" },
  { header: "Retail", source: "Retail", width: 60, align: "right" },
  { header: "UPC", source: "UPC", width: 104, align: "left" },
  { header: "Vendor", source: "Vendor", width: 96, align: "left" },
  { header: "On Hand", source: "On Hand", width: 56, align: "right" },
  { header: "Count", source: null, width: 62, align: "right" },
] as const;

// Column widths must sum to the printable width of landscape Letter
// (792pt - 2 * PAGE_MARGIN = 728pt). Overflow silently clips the rightmost
// column's header and cells rather than wrapping, so this is asserted below.
const PAGE_MARGIN = 32;
const PRINTABLE_WIDTH = 792 - PAGE_MARGIN * 2;
const PDF_COLUMNS_WIDTH = PDF_COLUMNS.reduce((sum, column) => sum + column.width, 0);
if (PDF_COLUMNS_WIDTH > PRINTABLE_WIDTH) {
  throw new Error(
    `PDF columns total ${PDF_COLUMNS_WIDTH}pt but only ${PRINTABLE_WIDTH}pt fit on the page.`,
  );
}

const ROW_HEIGHT = 15;
const HEADER_HEIGHT = 18;

export function buildMasterSheetPdf(input: MasterSheetInput, meta: MasterSheetMeta): Promise<Buffer> {
  const matrix = buildMasterSheetMatrix(input);
  const headerIndex = new Map(MASTER_SHEET_HEADERS.map((header, index) => [header, index]));
  const columns = PDF_COLUMNS.map((column) => ({
    ...column,
    index: column.source == null ? null : (headerIndex.get(column.source) ?? null),
  }));

  const pdf = new PDFDocument({
    size: "LETTER",
    layout: "landscape",
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: { Title: `${meta.brandName} inventory — ${meta.locationName}` },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  const right = pdf.page.width - PAGE_MARGIN;
  const bottom = pdf.page.height - PAGE_MARGIN - 18;

  const drawColumnHeaders = (top: number): number => {
    pdf
      .rect(PAGE_MARGIN, top, right - PAGE_MARGIN, HEADER_HEIGHT)
      .fill("#221245");
    let x = PAGE_MARGIN;
    pdf.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF");
    for (const column of columns) {
      pdf.text(column.header.toUpperCase(), x + 4, top + 5, {
        width: column.width - 8,
        align: column.align,
        lineBreak: false,
      });
      x += column.width;
    }
    return top + HEADER_HEIGHT + 2;
  };

  pdf.font("Helvetica-Bold").fontSize(15).fillColor("#0F0F11");
  pdf.text(`${meta.brandName} — Inventory`, PAGE_MARGIN, PAGE_MARGIN);
  pdf.font("Helvetica").fontSize(9).fillColor("#6B655E");
  pdf.text(`${meta.locationName} · On hand as of ${meta.stamp}`, PAGE_MARGIN, PAGE_MARGIN + 19);

  let y = drawColumnHeaders(PAGE_MARGIN + 38);
  let striped = false;

  for (const row of matrix.slice(1)) {
    const isCategory = row[0] === "category";
    const height = isCategory ? ROW_HEIGHT + 5 : ROW_HEIGHT;

    if (y + height > bottom) {
      pdf.addPage();
      y = drawColumnHeaders(PAGE_MARGIN);
      striped = false;
    }

    if (isCategory) {
      pdf.rect(PAGE_MARGIN, y, right - PAGE_MARGIN, height).fill("#E8ECEF");
      pdf.font("Helvetica-Bold").fontSize(9).fillColor("#221245");
      pdf.text(String(row[2] ?? "Uncategorized"), PAGE_MARGIN + 6, y + 5, {
        width: right - PAGE_MARGIN - 12,
        lineBreak: false,
      });
      y += height;
      striped = false;
      continue;
    }

    if (striped) {
      pdf.rect(PAGE_MARGIN, y, right - PAGE_MARGIN, height).fill("#F7F8F9");
    }
    striped = !striped;

    let x = PAGE_MARGIN;
    pdf.font("Helvetica").fontSize(8).fillColor("#2a2a2e");
    for (const column of columns) {
      const value = column.index == null ? "" : row[column.index];
      pdf.text(value == null || value === "" ? "" : String(value), x + 4, y + 4, {
        width: column.width - 8,
        align: column.align,
        ellipsis: true,
        lineBreak: false,
      });
      x += column.width;
    }
    y += height;
  }

  const pages = pdf.bufferedPageRange();
  for (let page = 0; page < pages.count; page += 1) {
    pdf.switchToPage(pages.start + page);
    pdf.font("Helvetica").fontSize(7.5).fillColor("#6B655E");
    pdf.text(
      `${meta.brandName} · ${meta.locationName} · ${meta.stamp}    Page ${page + 1} of ${pages.count}`,
      PAGE_MARGIN,
      pdf.page.height - PAGE_MARGIN - 8,
      { width: right - PAGE_MARGIN, align: "right", lineBreak: false },
    );
  }

  pdf.end();
  return done;
}
