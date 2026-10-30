import {
  EncryptedPDFError,
  PDFDocument,
  StandardFonts,
  rgb,
} from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import type { ContractProvider } from "./pdf";

export interface DocumentSignatureDetails {
  contractId: string;
  title: string;
  provider: ContractProvider;
  signerName: string;
  signerAddress: string;
  signaturePng: Uint8Array;
  signedAtIso: string;
  ip?: string | null;
  userAgent?: string | null;
  method?: string | null;
}

const LETTER: [number, number] = [612, 792];
const MARGIN = 54;
const INK = rgb(0.06, 0.06, 0.07);
const MUTED = rgb(0.38, 0.36, 0.33);
const ACCENT = rgb(0.13, 0.35, 0.51);

/** Upper bound on an uploaded agreement's length; bounds parse and save cost. */
export const MAX_SOURCE_PAGES = 200;

/**
 * Parse an uploaded agreement the same way signing will, so a PDF that cannot
 * be signed is refused at upload instead of failing in front of the client.
 * Returns an error message, or null when the PDF is usable.
 */
export async function checkSourcePdf(bytes: Uint8Array): Promise<string | null> {
  let pageCount: number;
  try {
    pageCount = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch (error) {
    return error instanceof EncryptedPDFError
      ? "The PDF is password-protected. Upload an unprotected copy."
      : "The PDF could not be read. Export it again and upload the new copy.";
  }
  if (pageCount < 1) return "The PDF has no pages.";
  if (pageCount > MAX_SOURCE_PAGES) {
    return `The PDF has ${pageCount} pages. The maximum is ${MAX_SOURCE_PAGES}.`;
  }
  return null;
}

function sanitizeText(value: unknown, font: PDFFont): string {
  let result = "";
  // Intl emits U+202F before AM/PM; it and other Unicode spaces are not WinAnsi.
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[\u2000-\u200b\u202f\u205f\u3000]/g, " ");
  for (const char of text) {
    if (char === "\n") {
      result += char;
      continue;
    }
    try {
      font.encodeText(char);
      result += char;
    } catch {
      result += "?";
    }
  }
  return result;
}

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let chunk = "";
      for (const char of word) {
        if (chunk && font.widthOfTextAtSize(chunk + char, size) > width) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawWrapped(
  page: PDFPage,
  text: unknown,
  font: PDFFont,
  size: number,
  y: number,
  options: { x?: number; width?: number; color?: ReturnType<typeof rgb>; lineHeight?: number } = {},
): number {
  const x = options.x ?? MARGIN;
  const width = options.width ?? LETTER[0] - MARGIN * 2;
  const lineHeight = options.lineHeight ?? size * 1.35;
  const safe = sanitizeText(text, font);
  for (const line of wrapText(safe, font, size, width)) {
    if (line) page.drawText(line, { x, y, size, font, color: options.color ?? INK });
    y -= lineHeight;
  }
  return y;
}

function humanDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/**
 * Append one auditable signature page to an uploaded PDF. The page is added to
 * the loaded source rather than a copy, so forms, outlines and metadata survive.
 */
export async function appendSignaturePage(
  sourcePdf: Uint8Array,
  details: DocumentSignatureDetails,
): Promise<Uint8Array> {
  const output = await PDFDocument.load(sourcePdf, { updateMetadata: false });

  const page = output.addPage(LETTER);
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  let y = LETTER[1] - MARGIN;

  page.drawText("Signature page", { x: MARGIN, y, size: 22, font: bold, color: ACCENT });
  y -= 32;
  y = drawWrapped(page, details.title, bold, 13, y);
  y = drawWrapped(page, `Contract ID: ${details.contractId}`, regular, 8, y - 2, {
    color: MUTED,
  });

  page.drawLine({
    start: { x: MARGIN, y: y - 4 },
    end: { x: LETTER[0] - MARGIN, y: y - 4 },
    thickness: 0.75,
    color: rgb(0.82, 0.8, 0.76),
  });
  y -= 28;

  page.drawText("SERVICE PROVIDER", { x: MARGIN, y, size: 8, font: bold, color: ACCENT });
  y = drawWrapped(page, details.provider.signatoryName, bold, 11, y - 17);
  y = drawWrapped(page, details.provider.signatoryTitle, regular, 9, y, { color: MUTED });
  y = drawWrapped(page, details.provider.legalName, regular, 9, y, { color: MUTED });

  page.drawText("SIGNER", { x: MARGIN, y: y - 10, size: 8, font: bold, color: ACCENT });
  y = drawWrapped(page, details.signerName, bold, 11, y - 28);
  page.drawText("Mailing address", { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  y = drawWrapped(page, details.signerAddress.trim(), regular, 9, y - 14, {
    lineHeight: 12,
  });

  page.drawText("Electronic signature", { x: MARGIN, y: y - 6, size: 8, font: bold, color: MUTED });
  y -= 92;
  const signature = await output.embedPng(details.signaturePng);
  const dimensions = signature.scaleToFit(240, 80);
  page.drawImage(signature, {
    x: MARGIN,
    y: y + (80 - dimensions.height) / 2,
    width: dimensions.width,
    height: dimensions.height,
  });
  page.drawLine({
    start: { x: MARGIN, y: y - 3 },
    end: { x: MARGIN + 260, y: y - 3 },
    thickness: 0.75,
    color: INK,
  });

  y -= 25;
  y = drawWrapped(page, `Signed: ${details.signedAtIso}`, regular, 8, y, { color: MUTED });
  y = drawWrapped(page, `Date: ${humanDate(details.signedAtIso)}`, regular, 8, y, {
    color: MUTED,
  });
  y = drawWrapped(page, `IP: ${details.ip || "Unavailable"}`, regular, 8, y, { color: MUTED });
  y = drawWrapped(
    page,
    `User agent: ${String(details.userAgent || "Unavailable").slice(0, 300)}`,
    regular,
    8,
    y,
    { color: MUTED, lineHeight: 10 },
  );
  drawWrapped(page, `Method: ${details.method || "Client e-signature link"}`, regular, 8, y, {
    color: MUTED,
  });

  return output.save();
}
