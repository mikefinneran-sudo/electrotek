import ExcelJS from "exceljs";

export async function readSheet(path: string, sheetName?: string): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);

  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];

  if (!worksheet) {
    throw new Error(sheetName ? `Worksheet not found: ${sheetName}` : "Workbook has no worksheets");
  }

  return worksheetRows(worksheet);
}

export function readCsvRows(text: string): unknown[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === "\"") {
      if (inQuotes && source[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";

      if (char === "\r" && source[index + 1] === "\n") {
        index += 1;
      }
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last && last.length === 1 && last[0] === "") {
      rows.pop();
    }
  }

  return rows;
}

export async function readXlsxRows(data: ArrayBuffer | Buffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  // exceljs declares `load(data: Buffer)`; the @types/node Buffer generic
  // (Buffer<ArrayBufferLike>) trips strict assignability but is fine at runtime.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new Error("Workbook has no worksheets");
  }

  return worksheetRows(worksheet);
}

function worksheetRows(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const worksheetRow = worksheet.getRow(rowNumber);
    const row: unknown[] = [];

    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      row.push(worksheetRow.getCell(columnNumber).value ?? null);
    }

    rows.push(row);
  }

  return rows;
}
