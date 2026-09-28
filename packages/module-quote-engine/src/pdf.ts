// Quote PDF generation (PDFKit). Ported from always-be-cleaning
// lib/quote-pdf.mjs + lib/quote-document.mjs. Generated on demand and streamed
// — never stored. Provider/brand details are passed in (no hard-coded client),
// keeping this module bolt-on per client.config.ts.

import PDFDocument from "pdfkit";
import { resolveQuoteLabels, type QuoteLabels } from "./labels";
import { computeTotals, lineTax, lineTotal, type QuoteLineItem } from "./line-items";
import {
  STANDARD_SERVICES,
  activeAddons,
  declinedAddons,
  formatUsd,
  resolveQuote,
} from "./pricing";
import type { Inspection, QuoteAddon, ResolvedQuote } from "./types";

export interface QuoteProvider {
  legalName: string;
  email: string;
  phone: string;
  web: string;
  tagline?: string;
}

const C = {
  signal: "#225a82",
  ink: "#0F0F11",
  body: "#2a2a2e",
  gray: "#6B655E",
  muted: "#918A80",
  paper: "#F5F7FA",
  shade: "#E9EEF3",
  border: "#E5DFD4",
  white: "#FFFFFF",
} as const;

const L = {
  margin: 54,
  footerH: 52,
  sectionGap: 26,
  afterSection: 8,
  bodySize: 10,
  bodyLineGap: 4,
  tableRowH: 30,
  tableHeadH: 28,
} as const;

interface ScopeItem {
  name: string;
  frequency: string;
  area: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateLong(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function visitFrequencyLong(visitsPerWeek: number | null): string {
  if (visitsPerWeek === 0.5) return "every two weeks (approximately 2 visits per month)";
  if (visitsPerWeek === 5) return "five (5) visits per week (Monday–Friday)";
  if (visitsPerWeek != null) return `${visitsPerWeek} visit(s) per week`;
  return "as scheduled in writing";
}

function visitFrequencyShort(visitsPerWeek: number | null): string {
  if (visitsPerWeek === 0.5) return "Every 2 weeks";
  if (visitsPerWeek === 5) return "Daily (M–F)";
  if (visitsPerWeek != null) return `${visitsPerWeek}×/week`;
  return "—";
}

/** Split a free-text scope field into trimmed, non-empty lines. */
function parseScopeLines(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildScopeItems(inspection: Inspection): ScopeItem[] {
  const standard: ScopeItem[] = STANDARD_SERVICES.map((s) => ({
    name: s.name,
    frequency: s.frequency,
    area: s.area,
  }));
  const site: ScopeItem[] = parseScopeLines(inspection.scope_inclusions).map((name) => ({
    name,
    frequency: "Per walkthrough",
    area: "Site-specific",
  }));
  return [...standard, ...site];
}

function groupByArea(items: ScopeItem[]): { area: string; items: ScopeItem[] }[] {
  const order: string[] = [];
  const map = new Map<string, ScopeItem[]>();
  for (const item of items) {
    const area = item.area || "General";
    if (!map.has(area)) {
      map.set(area, []);
      order.push(area);
    }
    map.get(area)!.push(item);
  }
  return order.map((area) => ({ area, items: map.get(area)! }));
}

function buildTerms(provider: QuoteProvider): string[] {
  return [
    "This proposal is valid for thirty (30) days from the issue date above.",
    "Pricing assumes the scope and frequency described herein. The first service visit is always treated as a one-time deep clean and is quoted separately from recurring service.",
    "Work outside this scope requires a written change order with approved pricing before commencement.",
    "Monthly service fees are invoiced in advance and due within fifteen (15) days of invoice date.",
    `Service begins upon execution of the ${provider.legalName} Services Agreement. Initial term is month-to-month unless otherwise stated in writing.`,
    "Either party may terminate recurring service with thirty (30) days written notice.",
    `${provider.legalName} maintains commercial general liability insurance appropriate for janitorial operations.`,
    "Contractor's total liability arising from this proposal or resulting services shall not exceed the fees paid by Customer in the twelve (12) months preceding any claim, except where prohibited by law.",
    "Customer provides building access (keys, codes, or lockbox) and secures alarm systems during service windows.",
    "Customer is responsible for securing valuables, sensitive documents, and pre-existing property conditions.",
  ];
}

type Doc = InstanceType<typeof PDFDocument>;

function sectionTitle(pdf: Doc, M: number, CW: number, title: string) {
  const y = pdf.y;
  pdf.rect(M, y + 2, 3, 14).fill(C.signal);
  pdf.font("Helvetica-Bold").fontSize(11).fillColor(C.ink).text(title, M + 12, y, { width: CW - 12 });
  pdf.y = y + 22;
}

function bodyPara(pdf: Doc, M: number, CW: number, text: string) {
  pdf.font("Helvetica").fontSize(L.bodySize).fillColor(C.body).text(text, M, pdf.y, {
    width: CW,
    align: "left",
    lineGap: L.bodyLineGap,
  });
  pdf.moveDown(0.5);
}

function leadText(pdf: Doc, M: number, CW: number, text: string) {
  pdf.font("Helvetica").fontSize(9.5).fillColor(C.gray).text(text, M, pdf.y, { width: CW, lineGap: 2 });
  pdf.moveDown(0.65);
}

function gap(pdf: Doc, pts: number) {
  pdf.y += pts;
}

function ensurePage(pdf: Doc, M: number, bottom: number, needed: number, y?: number): number {
  const current = y ?? pdf.y;
  if (current + needed > bottom) {
    pdf.addPage();
    pdf.x = M;
    pdf.y = M;
    return M;
  }
  return current;
}

function drawLetterhead(pdf: Doc, W: number, M: number, provider: QuoteProvider) {
  pdf.rect(0, 0, W, 84).fill(C.signal);
  pdf.fillColor(C.white).font("Helvetica-Bold").fontSize(13);
  pdf.text(provider.legalName.toUpperCase(), M, 26, { width: W - M * 2 });
  pdf.font("Helvetica").fontSize(8.5);
  if (provider.tagline) {
    pdf.text(provider.tagline, W - M - 230, 44, { width: 230, align: "right" });
  }
  pdf.text(`${provider.phone} · ${provider.email}`, W - M - 230, 58, {
    width: 230,
    align: "right",
  });
}

function drawMetaStrip(
  pdf: Doc,
  M: number,
  CW: number,
  quoteNumber: string,
  issueDate: string,
  validUntil: string,
  sqft: number | null,
  measureLabel: string,
  measureUnit: string,
) {
  const y = pdf.y;
  const h = 52;
  pdf.roundedRect(M, y, CW, h, 6).fill(C.paper).strokeColor(C.border).lineWidth(0.75).stroke();

  const cols: [string, string][] = [
    ["Quote", quoteNumber],
    ["Issued", formatDateLong(issueDate)],
    ["Valid through", formatDateLong(validUntil)],
    [measureLabel, sqft ? `${sqft.toLocaleString()} ${measureUnit}` : "—"],
  ];
  const colW = CW / 4;
  cols.forEach(([label, val], i) => {
    const x = M + 16 + i * colW;
    pdf.font("Helvetica").fontSize(7.5).fillColor(C.muted).text(label.toUpperCase(), x, y + 12, {
      width: colW - 16,
      characterSpacing: 0.5,
    });
    pdf.font("Helvetica-Bold").fontSize(10).fillColor(C.ink).text(val, x, y + 26, {
      width: colW - 16,
    });
  });
  pdf.y = y + h + 4;
}

function drawPricingTable(
  pdf: Doc,
  M: number,
  CW: number,
  quote: ResolvedQuote,
  freqShort: string,
  bottom: number,
  labels: QuoteLabels,
) {
  const rowH = L.tableRowH;
  const priceH = 56;
  let y = ensurePage(pdf, M, bottom, rowH * 4 + 50, pdf.y);

  pdf.roundedRect(M, y, CW, priceH, 6).fill(C.paper).strokeColor(C.border).lineWidth(0.75).stroke();
  pdf.font("Helvetica").fontSize(9).fillColor(C.gray).text(labels.totalCaption, M + 18, y + 14);
  const amount = quote.monthly != null ? formatUsd(quote.monthly) : "TBD";
  pdf.font("Helvetica-Bold").fontSize(26).fillColor(C.signal).text(amount, M + 18, y + 28, {
    width: CW * 0.45,
  });
  pdf.font("Helvetica").fontSize(9).fillColor(C.gray).text(labels.frequencyCaption, M + CW * 0.52, y + 14, {
    width: CW * 0.44,
  });
  pdf.font("Helvetica-Bold").fontSize(11).fillColor(C.ink).text(freqShort, M + CW * 0.52, y + 28, {
    width: CW * 0.44,
  });
  y += priceH + 14;

  const rows: [string, string][] = [];
  const desc = `${labels.serviceDescription}${
    quote.sqft ? ` — ${quote.sqft.toLocaleString()} ${labels.measureUnit}` : ""
  }`;
  rows.push([labels.serviceDescriptionLabel, desc]);
  if (quote.baseMonthly != null) {
    rows.push([labels.baseLabel, formatUsd(quote.baseMonthly)]);
  }
  if (quote.ratePerSqft != null) {
    const rateStr = `$${quote.ratePerSqft.toFixed(4)} / ${labels.measureUnit} / visit`;
    rows.push([labels.rateLabel, rateStr]);
  }
  for (const addon of quote.addons) {
    rows.push([
      `${labels.addonPrefix} · ${addon.name}`,
      addon.price == null ? "Unpriced" : `${formatUsd(addon.price)} / mo`,
    ]);
  }
  if (quote.perVisit != null) {
    rows.push([labels.perVisitLabel, formatUsd(Math.round(quote.perVisit))]);
  }
  if (quote.annual != null) {
    rows.push([labels.annualLabel, formatUsd(quote.annual)]);
  }
  rows.push([labels.billingTermsLabel, labels.billingTermsValue]);

  rows.forEach(([label, val], idx) => {
    y = ensurePage(pdf, M, bottom, rowH + 4, y);
    const fill = idx % 2 === 0 ? C.white : C.paper;
    pdf.rect(M, y, CW, rowH).fill(fill).strokeColor(C.border).lineWidth(0.5).stroke();
    pdf.fillColor(C.gray).font("Helvetica").fontSize(9).text(label, M + 14, y + 10, {
      width: CW * 0.48,
    });
    pdf.fillColor(C.ink).font("Helvetica-Bold").fontSize(9).text(val, M + CW * 0.5, y + 10, {
      width: CW * 0.5 - 16,
      align: "right",
    });
    y += rowH;
  });

  pdf.y = y + L.afterSection;
}

/** Money with cents. The line grid needs them; the headline figure does not. */
function formatUsdCents(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Drop a trailing `.00` so a whole-number quantity reads as "1", not "1.00". */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/**
 * The line grid — description / qty / unit price / tax / amount, then the
 * subtotal-tax-total block.
 *
 * This is the table the merge was for. `drawPricingTable` below renders the old
 * sqft-and-add-ons summary and is still used for a quote that has no lines,
 * because a quote written before 0006 has add-on rows and nothing else, and its
 * PDF must keep rendering the price it was issued at.
 *
 * `totals` comes from the stored inspection where possible; the computed sum is
 * the fallback for a draft preview whose lines have never been written.
 */
function drawLineItemsTable(
  pdf: Doc,
  M: number,
  CW: number,
  lines: readonly QuoteLineItem[],
  totals: { subtotal: number; tax: number; total: number },
  freqShort: string,
  bottom: number,
  labels: QuoteLabels,
) {
  const priceH = 56;
  let y = ensurePage(pdf, M, bottom, priceH + L.tableHeadH + L.tableRowH * 2, pdf.y);

  // Headline figure first — the number the customer is looking for.
  pdf.roundedRect(M, y, CW, priceH, 6).fill(C.paper).strokeColor(C.border).lineWidth(0.75).stroke();
  pdf.font("Helvetica").fontSize(9).fillColor(C.gray).text(labels.totalCaption, M + 18, y + 14);
  pdf.font("Helvetica-Bold").fontSize(26).fillColor(C.signal).text(formatUsd(totals.total), M + 18, y + 28, {
    width: CW * 0.45,
  });
  pdf.font("Helvetica").fontSize(9).fillColor(C.gray).text(labels.frequencyCaption, M + CW * 0.52, y + 14, {
    width: CW * 0.44,
  });
  pdf.font("Helvetica-Bold").fontSize(11).fillColor(C.ink).text(freqShort, M + CW * 0.52, y + 28, {
    width: CW * 0.44,
  });
  y += priceH + 14;

  // Column geometry, as fractions of the content width.
  const wDesc = CW * 0.46;
  const wQty = CW * 0.09;
  const wUnit = CW * 0.15;
  const wTax = CW * 0.13;
  const wAmount = CW * 0.17;
  const xDesc = M;
  const xQty = xDesc + wDesc;
  const xUnit = xQty + wQty;
  const xTax = xUnit + wUnit;
  const xAmount = xTax + wTax;
  const pad = 12;

  function head() {
    const hy = ensurePage(pdf, M, bottom, L.tableHeadH + L.tableRowH, pdf.y);
    pdf.rect(M, hy, CW, L.tableHeadH).fill(C.shade).strokeColor(C.border).lineWidth(0.5).stroke();
    pdf.fillColor(C.gray).font("Helvetica-Bold").fontSize(8);
    pdf.text(labels.lineDescriptionHeading, xDesc + pad, hy + 10, { width: wDesc - pad * 2 });
    pdf.text(labels.lineQuantityHeading, xQty, hy + 10, { width: wQty - 6, align: "right" });
    pdf.text(labels.lineUnitPriceHeading, xUnit, hy + 10, { width: wUnit - 6, align: "right" });
    pdf.text(labels.lineTaxHeading, xTax, hy + 10, { width: wTax - 6, align: "right" });
    pdf.text(labels.lineAmountHeading, xAmount, hy + 10, { width: wAmount - pad, align: "right" });
    return hy + L.tableHeadH;
  }

  pdf.y = y;
  y = head();

  lines.forEach((line, idx) => {
    // A long description wraps, so the row grows with it rather than clipping.
    pdf.font("Helvetica").fontSize(9);
    const descH = pdf.heightOfString(line.description, { width: wDesc - pad * 2 });
    const rowH = Math.max(L.tableRowH, descH + 16);

    const before = y;
    y = ensurePage(pdf, M, bottom, rowH + 2, y);
    // A page break mid-table needs the header repeated, or the continuation
    // columns are unlabelled.
    if (y !== before) {
      pdf.y = y;
      y = head();
    }

    pdf.rect(M, y, CW, rowH).fill(idx % 2 === 0 ? C.white : C.paper).strokeColor(C.border).lineWidth(0.5).stroke();
    pdf.fillColor(C.ink).font("Helvetica").fontSize(9).text(line.description, xDesc + pad, y + 10, {
      width: wDesc - pad * 2,
      lineGap: 2,
    });
    pdf.fillColor(C.body).font("Helvetica").fontSize(9);
    pdf.text(formatQuantity(line.quantity), xQty, y + 10, {
      width: wQty - 6,
      align: "right",
      lineBreak: false,
    });
    pdf.text(formatUsdCents(line.unit_price), xUnit, y + 10, {
      width: wUnit - 6,
      align: "right",
      lineBreak: false,
    });
    // The dollar amount, not the rate: "7%" of an unstated base is not something
    // a customer can check, but $5.95 against a $85.00 line is.
    pdf.text(lineTax(line) > 0 ? formatUsdCents(lineTax(line)) : "—", xTax, y + 10, {
      width: wTax - 6,
      align: "right",
      lineBreak: false,
    });
    pdf.fillColor(C.ink).font("Helvetica-Bold").fontSize(9).text(
      formatUsdCents(line.line_total ?? lineTotal(line)),
      xAmount,
      y + 10,
      { width: wAmount - pad, align: "right", lineBreak: false },
    );
    y += rowH;
  });

  // --- subtotal / tax / total ---------------------------------------------
  const summary: [string, string, boolean][] = [
    [labels.subtotalLabel, formatUsdCents(totals.subtotal), false],
    [labels.taxLabel, formatUsdCents(totals.tax), false],
    [labels.grandTotalLabel, formatUsdCents(totals.total), true],
  ];
  const labelX = xUnit;
  const labelW = wUnit + wTax - 6;

  for (const [label, value, emphasis] of summary) {
    y = ensurePage(pdf, M, bottom, L.tableRowH + 4, y);
    pdf.rect(labelX, y, labelW + wAmount, L.tableRowH)
      .fill(emphasis ? C.shade : C.white)
      .strokeColor(C.border)
      .lineWidth(0.5)
      .stroke();
    pdf.fillColor(emphasis ? C.ink : C.gray)
      .font(emphasis ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9)
      .text(label, labelX + 6, y + 10, { width: labelW - 6, align: "right", lineBreak: false });
    pdf.fillColor(emphasis ? C.signal : C.ink)
      .font("Helvetica-Bold")
      .fontSize(emphasis ? 10 : 9)
      .text(value, xAmount, y + 10, { width: wAmount - pad, align: "right", lineBreak: false });
    y += L.tableRowH;
  }

  pdf.y = y + L.afterSection;
}

function drawScopeTable(
  pdf: Doc,
  M: number,
  CW: number,
  groups: { area: string; items: ScopeItem[] }[],
  bottom: number,
  labels: QuoteLabels,
) {
  const taskW = CW * 0.68;
  const freqW = CW * 0.32;
  const headerH = L.tableHeadH;
  let y = ensurePage(pdf, M, bottom, headerH + 12, pdf.y);

  pdf.rect(M, y, CW, headerH).fill(C.shade).strokeColor(C.border).lineWidth(0.5).stroke();
  pdf.fillColor(C.gray).font("Helvetica-Bold").fontSize(8).text(labels.scopeItemHeading, M + 14, y + 10, {
    width: taskW - 20,
  });
  pdf.text(labels.scopeFrequencyHeading, M + taskW, y + 10, { width: freqW - 14, align: "right" });
  y += headerH;

  for (const { area, items } of groups) {
    y = ensurePage(pdf, M, bottom, 24, y);
    pdf.rect(M, y, CW, 22).fill(C.white).strokeColor(C.border).lineWidth(0.5).stroke();
    pdf.fillColor(C.signal).font("Helvetica-Bold").fontSize(8).text(area.toUpperCase(), M + 14, y + 7, {
      width: CW - 28,
      characterSpacing: 0.5,
    });
    y += 22;

    for (const item of items) {
      pdf.font("Helvetica").fontSize(9.5);
      const nameH = pdf.heightOfString(item.name, { width: taskW - 28 });
      const itemRowH = Math.max(L.tableRowH, nameH + 16);
      y = ensurePage(pdf, M, bottom, itemRowH + 2, y);
      pdf.rect(M, y, CW, itemRowH).fill(C.white).strokeColor(C.border).lineWidth(0.5).stroke();
      pdf.fillColor(C.ink).font("Helvetica").fontSize(9.5).text(item.name, M + 14, y + 10, {
        width: taskW - 28,
        lineGap: 2,
      });
      pdf.fillColor(C.gray).font("Helvetica").fontSize(9.5).text(item.frequency, M + taskW, y + 10, {
        width: freqW - 14,
        align: "right",
        lineBreak: false,
      });
      y += itemRowH;
    }
  }

  pdf.y = y + L.afterSection;
}

function drawBulletList(
  pdf: Doc,
  M: number,
  CW: number,
  items: string[],
  bottom: number,
  startY: number,
): number {
  const pad = 16;
  let contentH = pad * 2 + 4;
  const rowHeights = items.map((item) => {
    const h = pdf.heightOfString(item, { width: CW - pad * 2 - 24 }) + 10;
    contentH += h;
    return h;
  });

  const boxY = ensurePage(pdf, M, bottom, contentH + 12, startY);
  pdf.roundedRect(M, boxY, CW, contentH, 6).fill("#FAF8F6").strokeColor(C.border).lineWidth(0.75).stroke();

  let ly = boxY + pad;
  items.forEach((item, i) => {
    pdf.fillColor(C.muted).font("Helvetica").fontSize(9.5).text("—", M + pad, ly + 1, {
      width: 14,
      lineBreak: false,
    });
    pdf.fillColor(C.body).font("Helvetica").fontSize(9.5).text(item, M + pad + 18, ly, {
      width: CW - pad * 2 - 24,
      lineGap: 2,
    });
    ly += rowHeights[i];
  });

  pdf.y = boxY + contentH;
  return pdf.y;
}

function drawScheduleTable(
  pdf: Doc,
  M: number,
  CW: number,
  rows: [string, string][],
  bottom: number,
) {
  const labelW = CW * 0.4;
  const rowH = L.tableRowH;
  let y = pdf.y;

  rows.forEach(([label, val], idx) => {
    y = ensurePage(pdf, M, bottom, rowH + 4, y);
    const fill = idx % 2 === 0 ? C.white : C.paper;
    pdf.rect(M, y, CW, rowH).fill(fill).strokeColor(C.border).lineWidth(0.5).stroke();
    pdf.fillColor(C.gray).font("Helvetica").fontSize(9.5).text(label, M + 14, y + 10, {
      width: labelW,
    });
    pdf.fillColor(C.ink).font("Helvetica-Bold").fontSize(9.5).text(val, M + labelW, y + 10, {
      width: CW - labelW - 16,
    });
    y += rowH;
  });
  pdf.y = y + L.afterSection;
}

function drawFooter(
  pdf: Doc,
  W: number,
  M: number,
  CW: number,
  provider: QuoteProvider,
  quoteNumber: string,
  pageNum: number,
  pageCount: number,
) {
  const y = pdf.page.height - L.footerH + 8;
  pdf.save();
  pdf.strokeColor(C.border).lineWidth(0.5).moveTo(M, y).lineTo(W - M, y).stroke();
  pdf.fillColor(C.muted).font("Helvetica").fontSize(7.5);
  pdf.text(`${provider.legalName} · ${provider.web} · ${provider.email} · ${provider.phone}`, M, y + 12, {
    width: CW * 0.72,
  });
  pdf.text(`Quote ${quoteNumber}`, M, y + 24, { width: CW * 0.72 });
  pdf.text(`Page ${pageNum} of ${pageCount}`, W - M - 64, y + 12, { width: 64, align: "right" });
  pdf.restore();
}

/**
 * Totals for the grid.
 *
 * Prefers the STORED values: the trigger computed them from these same rows, and
 * a document that shows a number this code derived could disagree with the
 * database it was issued from. `computeTotals` is the fallback for a preview
 * whose lines have not been written yet — it is the same arithmetic as the
 * trigger, per-line rounding included.
 *
 * The stored figures are only trusted when the quote actually sums to something.
 * A stored 0 against non-zero lines means the trigger has not fired for these
 * rows (an in-memory preview), so the computed sum is the honest number.
 */
function lineTotalsFor(
  inspection: Inspection,
  lines: readonly QuoteLineItem[],
): { subtotal: number; tax: number; total: number } {
  const computed = computeTotals(lines);
  if (inspection.total > 0 || computed.total === 0) {
    return { subtotal: inspection.subtotal, tax: inspection.tax, total: inspection.total };
  }
  return computed;
}

/**
 * Render a commercial cleaning proposal PDF for an inspection. Returns the PDF
 * as a Buffer; the caller streams it. Nothing is persisted.
 *
 * `lines` renders the itemised grid. Omit it (or pass none) and the document
 * falls back to the sqft-and-add-ons summary — which is what a quote issued
 * before the line-item model has.
 */
export function generateQuotePdf(
  inspection: Inspection,
  addons: readonly QuoteAddon[],
  provider: QuoteProvider,
  labelOverrides?: Partial<QuoteLabels> | null,
  lines: readonly QuoteLineItem[] = [],
): Promise<Buffer> {
  // Omitting overrides yields the exact wording this document has always used,
  // so existing deploys render unchanged.
  const labels = resolveQuoteLabels(labelOverrides);
  const quote = resolveQuote(inspection, addons);
  const included = activeAddons(addons);
  const declined = declinedAddons(addons);
  const exclusions = parseScopeLines(inspection.scope_exclusions);
  const scopeGroups = groupByArea(buildScopeItems(inspection));

  // Issue date and validity are read from the RECORD, not from the clock. Both
  // used to be derived at render time (today, today + 30), which meant every
  // re-download of an already-sent quote reissued it with a fresh 30-day window
  // and a new issue date — the document contradicted itself between downloads.
  // The addDays fallback now only covers a draft preview, which has no
  // valid_until until it is sent.
  const issueDate = (inspection.sent_at ?? inspection.created_at ?? todayIso()).slice(0, 10);
  const validUntil = inspection.valid_until ?? addDays(issueDate, 30);
  const quoteNumber = inspection.estimate_number || inspection.inspection_slug || inspection.id;
  const company = inspection.prospect_company || inspection.prospect_name || "Client";

  // ONE figure for the whole document. When a quote is priced by line, the lines
  // are the price — so the prose has to quote the same number the grid adds up
  // to. Deriving the summary from `resolveQuote` while the grid came from the
  // lines had the Overview paragraph reading $1,384 under a grid totalling
  // $1,865.50: it ignored the operator's manual line and all tax. A document
  // that contradicts itself is worse than one with less detail.
  const lineTotals = lineTotalsFor(inspection, lines);
  const documentTotal = lines.length ? lineTotals.total : quote.monthly;
  const freqLong = visitFrequencyLong(inspection.visits_per_week);
  const freqShort = visitFrequencyShort(inspection.visits_per_week);

  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ size: "LETTER", margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const M = L.margin;
    const W = pdf.page.width;
    const CW = W - M * 2;
    const bottom = pdf.page.height - L.footerH;

    drawLetterhead(pdf, W, M, provider);
    pdf.y = 108;

    pdf.fillColor(C.ink).font("Helvetica-Bold").fontSize(20).text(labels.documentTitle, M, pdf.y, {
      width: CW,
      lineGap: 2,
    });
    pdf.moveDown(0.35);
    pdf.font("Helvetica-Bold").fontSize(13).fillColor(C.body).text(company, M, pdf.y, { width: CW });
    if (inspection.office_address) {
      pdf.moveDown(0.25);
      pdf.font("Helvetica").fontSize(10).fillColor(C.gray).text(inspection.office_address, M, pdf.y, {
        width: CW,
      });
    }
    pdf.moveDown(1.1);

    drawMetaStrip(pdf, M, CW, quoteNumber, issueDate, validUntil, quote.sqft, "Cleanable area", labels.measureUnit);
    gap(pdf, L.sectionGap);

    sectionTitle(pdf, M, CW, "Investment Summary");
    if (lines.length) {
      drawLineItemsTable(pdf, M, CW, lines, lineTotals, freqShort, bottom, labels);
    } else {
      // No lines: this quote predates the line-item model (or has not been
      // generated yet). Render exactly what it always rendered.
      drawPricingTable(pdf, M, CW, quote, freqShort, bottom, labels);
    }
    gap(pdf, L.sectionGap);

    sectionTitle(pdf, M, CW, "Overview");
    bodyPara(
      pdf,
      M,
      CW,
      `${provider.legalName} is pleased to submit this proposal for recurring commercial ` +
        `janitorial services for ${company}` +
        `${inspection.office_address ? ` at ${inspection.office_address}` : ""}` +
        `${quote.sqft ? ` (${quote.sqft.toLocaleString()} ${labels.measureUnit})` : ""}. ` +
        `We recommend ${freqLong}` +
        `${documentTotal != null ? ` at a fixed monthly investment of ${formatUsd(documentTotal)}` : ""}. ` +
        "Scope, schedule, and investment details are outlined below.",
    );
    gap(pdf, L.sectionGap);

    if (scopeGroups.length) {
      ensurePage(pdf, M, bottom, 140);
      sectionTitle(pdf, M, CW, "Scope of Services");
      leadText(
        pdf,
        M,
        CW,
        "Standard services included for every client, plus site-specific tasks from your walkthrough.",
      );
      drawScopeTable(pdf, M, CW, scopeGroups, bottom, labels);
      gap(pdf, L.sectionGap);
    }

    if (included.length || declined.length) {
      ensurePage(pdf, M, bottom, 90);
      sectionTitle(pdf, M, CW, "Add-on Services");
      if (included.length) {
        leadText(pdf, M, CW, "Included in your monthly investment:");
        drawBulletList(
          pdf,
          M,
          CW,
          included.map((a) =>
            `${a.name}${a.price != null && a.price > 0 ? ` — ${formatUsd(a.price)}/mo` : ""}`,
          ),
          bottom,
          pdf.y,
        );
      }
      if (declined.length) {
        pdf.y += 8;
        leadText(
          pdf,
          M,
          CW,
          "Available but not included (may be added by written change order):",
        );
        drawBulletList(pdf, M, CW, declined.map((a) => a.name), bottom, pdf.y);
      }
      gap(pdf, L.sectionGap);
    }

    if (exclusions.length) {
      ensurePage(pdf, M, bottom, 90);
      sectionTitle(pdf, M, CW, "Not Included");
      leadText(pdf, M, CW, "Unless separately quoted and approved in writing.");
      drawBulletList(pdf, M, CW, exclusions, bottom, pdf.y);
      gap(pdf, L.sectionGap);
    }

    ensurePage(pdf, M, bottom, 120);
    sectionTitle(pdf, M, CW, "Service Schedule");
    drawScheduleTable(
      pdf,
      M,
      CW,
      [
        ["Service frequency", freqLong],
        ["Visits per month (est.)", quote.visitsPerMonth != null ? String(quote.visitsPerMonth) : "—"],
        ["Cleaning days", inspection.cleaning_days || "As agreed"],
        ["Service window", inspection.clean_window || "As agreed"],
        ["Proposed start date", inspection.target_start || "Upon signed agreement"],
      ],
      bottom,
    );
    gap(pdf, L.sectionGap);

    ensurePage(pdf, M, bottom, 160);
    sectionTitle(pdf, M, CW, "Terms & Conditions");
    buildTerms(provider).forEach((t, i) => {
      ensurePage(pdf, M, bottom, 32);
      pdf.font("Helvetica").fontSize(L.bodySize).fillColor(C.body).text(`${i + 1}.  ${t}`, M + 4, pdf.y, {
        width: CW - 4,
        lineGap: L.bodyLineGap,
        paragraphGap: 4,
      });
      pdf.moveDown(0.55);
    });
    gap(pdf, L.sectionGap);

    ensurePage(pdf, M, bottom, 60);
    sectionTitle(pdf, M, CW, "Next Steps");
    bodyPara(
      pdf,
      M,
      CW,
      `To proceed, reply to ${provider.email} or call ${provider.phone}. ` +
        `We will send a separate link to review and sign the ${provider.legalName} Services Agreement. ` +
        "Service begins upon executed agreement.",
    );

    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      drawFooter(pdf, W, M, CW, provider, quoteNumber, i + 1, range.count);
    }

    pdf.end();
  });
}

/** Suggested download filename for a quote PDF. */
export function quotePdfFilename(company: string | null | undefined): string {
  const slug = String(company || "client")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48);
  return `Proposal-${slug || "client"}.pdf`;
}
