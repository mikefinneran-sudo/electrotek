// Signed cleaning services agreement PDF (PDFKit). Ported from always-be-cleaning
// lib/contract-template.mjs (the 12 legal sections), lib/contract-agreement.mjs
// (the agreement payload builder), and lib/contract-pdf.mjs (the renderer +
// signature embed). Pure rendering — no I/O, no env, no service client: it takes
// an inspection-derived agreement context, the provider/signatory brand, and the
// decoded signature PNG, and returns the PDF bytes. server.ts handles storing
// the result in the private `contracts` Storage bucket.

import PDFDocument from "pdfkit";
import type { InspectionRef } from "./server";

export interface ContractProvider {
  /** Full legal entity name, e.g. "Always Be Cleaning, LLC". */
  legalName: string;
  /** Short/common name used in body prose, e.g. "Always Be Cleaning". */
  shortName: string;
  signatoryName: string;
  signatoryTitle: string;
  email: string;
  phone: string;
  privacyUrl?: string;
  servicesUrl?: string;
}

export interface SignatureDetails {
  signerName: string;
  signerTitle?: string | null;
  /** Decoded PNG bytes for the customer's drawn signature (may be empty). */
  signaturePng?: Uint8Array | null;
  /** YYYY-MM-DD execution date. */
  signedAt: string;
  signedAtIso?: string;
  ip?: string | null;
  userAgent?: string | null;
  method?: string | null;
}

export const TEMPLATE_VERSION = "2026-06";

const C = {
  signal: "#225a82",
  accent: "#3da6c5",
  ink: "#0F0F11",
  body: "#2a2a2e",
  gray: "#6B655E",
  muted: "#918A80",
  paper: "#F5F7FA",
  shade: "#E9EEF3",
  border: "#E5DFD4",
  white: "#FFFFFF",
} as const;

const M = 54;
const HEADER_H = 84;
const FOOTER_H = 46;

// --- agreement context ---------------------------------------------------

interface AgreementSection {
  title: string;
  text: string;
}

interface AgreementContext {
  title: string;
  effectiveDate: string;
  provider: ContractProvider;
  customer: { company: string; address: string; representative: string };
  summary: {
    monthly: string;
    visitsLabel: string;
    targetStart: string;
  };
  sections: AgreementSection[];
}

function formatMoney(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "$___________";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function visitFrequencyLong(visitsPerWeek: number | null): string {
  if (visitsPerWeek === 0.5) return "every two weeks (approximately 2 visits per month)";
  if (visitsPerWeek === 5) return "five (5) visits per week (Monday–Friday)";
  if (visitsPerWeek != null) return `${visitsPerWeek} visit(s) per week`;
  return "as scheduled in writing";
}

function formatConsumables(value: string | null): string {
  if (!value) return "provided by Contractor unless otherwise noted";
  const map: Record<string, string> = {
    Provider: "provided by Contractor",
    Client: "provided by Customer",
    Split: "split per walkthrough notes",
  };
  return map[value] ?? value;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "___________";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// The 12 legal sections, ported verbatim in substance from contract-template.mjs.
function buildSections(ctx: {
  providerShort: string;
  customerAddress: string;
  monthlyFee: string;
  visitFrequency: string;
  scopeInclusions: string;
  scopeExclusions: string;
  chemicals: string;
  consumables: string;
  cleaningDays: string;
  cleanWindow: string;
  targetStart: string;
  effectiveDate: string;
  privacyUrl: string;
  servicesUrl: string;
}): AgreementSection[] {
  return [
    {
      title: "SERVICES",
      text: `${ctx.providerShort} ("Contractor") agrees to provide recurring commercial office cleaning at Customer's premises located at ${ctx.customerAddress}, in accordance with the scope in Section 3 and the visit checklist generated when this Agreement is executed.`,
    },
    {
      title: "FEES & PAYMENT",
      text:
        `Customer agrees to pay a fixed monthly service fee of ${ctx.monthlyFee} USD, invoiced monthly in advance. ` +
        `This fee covers ${ctx.visitFrequency} at the scope defined in Section 3. ` +
        "Invoices are due within fifteen (15) days of receipt. Late balances may accrue a service charge of 1.5% per month. " +
        "Work outside the written scope requires a change order with pricing approved in writing before Contractor begins.",
    },
    {
      title: "SCOPE OF WORK",
      text:
        `Included services (frequency per task noted):\n${ctx.scopeInclusions}\n\n` +
        `Explicitly excluded unless separately quoted:\n${ctx.scopeExclusions}\n\n` +
        `Cleaning products / chemical requirements: ${ctx.chemicals}\n\n` +
        `Consumables (paper products, liners, soap, etc.): ${ctx.consumables}.`,
    },
    {
      title: "SCHEDULE, ACCESS & SECURITY",
      text:
        `Service frequency: ${ctx.visitFrequency}.\n` +
        `Cleaning days: ${ctx.cleaningDays}.\n` +
        `Service window: ${ctx.cleanWindow}.\n` +
        `Target start: ${ctx.targetStart}.\n\n` +
        "Customer provides building access (keys, codes, or lockbox) sufficient for Contractor to perform services. " +
        "Access details are documented at onboarding. Each visit ends with a locked-on-exit confirmation recorded on the signed visit checklist.",
    },
    {
      title: "CHECKLIST, CREW & QUALITY",
      text:
        "Contractor assigns a consistent crew to Customer's account where operationally feasible. " +
        "After each visit, Contractor provides a signed checklist of completed tasks derived from the scope above. " +
        "If Customer reports a missed task within five (5) business days of the visit, Contractor corrects it on the next scheduled visit at no additional charge.",
    },
    {
      title: "TERM & TERMINATION",
      text:
        `This Agreement begins on ${ctx.effectiveDate} and continues month-to-month until terminated. ` +
        "Either party may terminate with thirty (30) days written notice to the other party. " +
        "Termination does not relieve Customer of payment for services performed through the end of the notice period.",
    },
    {
      title: "RELATIONSHIP OF THE PARTIES",
      text:
        "The parties are independent contractors. Nothing in this Agreement creates an employment, partnership, joint venture, or agency relationship. " +
        "Contractor's employees and subcontractors are not Customer's employees.",
    },
    {
      title: "INSURANCE, LIMITATION OF LIABILITY & INDEMNITY",
      text:
        "Contractor maintains commercial general liability insurance appropriate for janitorial services. " +
        "Upon request, Contractor will provide a certificate of insurance naming Customer as certificate holder where commercially reasonable.\n\n" +
        "TO THE MAXIMUM EXTENT PERMITTED BY LAW, CONTRACTOR'S TOTAL LIABILITY ARISING FROM OR RELATED TO THIS AGREEMENT — WHETHER IN CONTRACT, TORT, OR OTHERWISE — SHALL NOT EXCEED THE FEES PAID BY CUSTOMER TO CONTRACTOR IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM. " +
        "IN NO EVENT SHALL CONTRACTOR BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS OR BUSINESS INTERRUPTION.\n\n" +
        "Customer agrees to indemnify and hold Contractor harmless from claims arising from (a) Customer's failure to provide safe access or accurate premises information, (b) hazardous conditions not caused by Contractor, or (c) Customer's direction to use non-standard products or methods.",
    },
    {
      title: "FORCE MAJEURE",
      text:
        "Neither party is liable for delay or failure to perform due to events beyond reasonable control, including severe weather, utility outages, labor disputes, or government orders. " +
        "Contractor will resume service as soon as practicable and notify Customer of material disruptions.",
    },
    {
      title: "CONFIDENTIALITY & PREMISES",
      text:
        "Contractor treats non-public information observed at Customer's premises as confidential and uses it only to perform services. " +
        "Customer is responsible for securing valuables, sensitive documents, and alarm systems. Contractor is not liable for pre-existing damage or conditions not caused by Contractor's negligence.",
    },
    {
      title: "POLICIES",
      text:
        `Customer agrees to Contractor's published Privacy Policy (${ctx.privacyUrl}). ` +
        `Service standards and quote process are described at ${ctx.servicesUrl}.`,
    },
    {
      title: "ENTIRE AGREEMENT",
      text:
        `This Agreement, including the scope and pricing derived from the walkthrough dated ${ctx.effectiveDate}, is the entire agreement between the parties for cleaning services at the listed location. ` +
        "Amendments must be in writing and signed by both parties. If any provision is held unenforceable, the remaining provisions remain in effect.",
    },
  ];
}

/**
 * Build the agreement context for an inspection + provider. Pure (no I/O), so it
 * can be unit-tested and reused by both the PDF renderer and the agreement
 * preview shown on the sign page.
 */
export function buildAgreement(
  inspection: InspectionRef,
  provider: ContractProvider,
): AgreementContext {
  const company = inspection.prospect_company || inspection.prospect_name || "Customer";
  const address = inspection.office_address || "___________________";
  const representative = inspection.prospect_name || "___________________";
  const monthly = formatMoney(inspection.quote_base_monthly);
  const visitFrequency = visitFrequencyLong(inspection.visits_per_week);
  const effectiveDateRaw = inspection.walkthrough_date || todayIso();
  const effectiveDate = formatDate(effectiveDateRaw);
  const targetStart = inspection.target_start || "Upon execution";

  const sections = buildSections({
    providerShort: provider.shortName,
    customerAddress: address,
    monthlyFee: monthly,
    visitFrequency,
    scopeInclusions: inspection.scope_inclusions || "Per walkthrough notes on file.",
    scopeExclusions: inspection.scope_exclusions || "None specified.",
    chemicals: "Standard Contractor supplies unless noted.",
    consumables: formatConsumables(inspection.consumables_provided_by),
    cleaningDays: inspection.cleaning_days || "As agreed",
    cleanWindow: inspection.clean_window || "As agreed",
    targetStart,
    effectiveDate,
    privacyUrl: provider.privacyUrl || "#",
    servicesUrl: provider.servicesUrl || "#",
  });

  return {
    title: `${provider.legalName.toUpperCase()} — CLEANING SERVICES AGREEMENT`,
    effectiveDate: effectiveDateRaw,
    provider,
    customer: { company, address, representative },
    summary: { monthly, visitsLabel: visitFrequency, targetStart },
    sections,
  };
}

// --- rendering -----------------------------------------------------------

type Doc = InstanceType<typeof PDFDocument>;

function drawLetterhead(pdf: Doc, W: number, provider: ContractProvider) {
  pdf.rect(0, 0, W, HEADER_H).fill(C.signal);
  pdf.rect(0, HEADER_H, W, 3).fill(C.accent);
  pdf.fillColor(C.white).font("Helvetica-Bold").fontSize(13);
  pdf.text(provider.legalName.toUpperCase(), M, 26, { width: W - M * 2 });
  pdf.font("Helvetica").fontSize(8.5).fillColor("#cfe2ee");
  pdf.text("Cleaning Services Agreement", W - M - 230, 42, { width: 230, align: "right" });
  pdf.text(`${provider.phone} · ${provider.email}`, W - M - 230, 56, {
    width: 230,
    align: "right",
  });
}

function eyebrow(pdf: Doc, CW: number, text: string) {
  pdf.fillColor(C.muted).font("Helvetica-Bold").fontSize(8).text(text, M, pdf.y, {
    width: CW,
    characterSpacing: 1.4,
  });
}

function drawSummaryStrip(pdf: Doc, CW: number, agreement: AgreementContext) {
  const y = pdf.y;
  const h = 56;
  pdf.roundedRect(M, y, CW, h, 6).fill(C.paper).strokeColor(C.border).lineWidth(0.75).stroke();

  const monthly = agreement.summary.monthly;
  const cols: [string, string][] = [
    ["Effective date", formatDate(agreement.effectiveDate)],
    ["Monthly service", monthly],
    ["Frequency", agreement.summary.visitsLabel],
    [
      "Start",
      agreement.summary.targetStart && agreement.summary.targetStart !== "Upon execution"
        ? formatDate(agreement.summary.targetStart)
        : "On signing",
    ],
  ];
  const colW = CW / cols.length;
  cols.forEach(([label, val], i) => {
    const x = M + 16 + i * colW;
    pdf.font("Helvetica").fontSize(7.5).fillColor(C.muted).text(label.toUpperCase(), x, y + 13, {
      width: colW - 18,
      characterSpacing: 0.5,
    });
    pdf
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(i === 1 ? C.signal : C.ink)
      .text(val, x, y + 28, { width: colW - 18 });
  });
  pdf.y = y + h;
}

function ensureSpace(pdf: Doc, bottom: number, needed: number) {
  if (pdf.y + needed > bottom) {
    pdf.addPage();
    pdf.y = M;
  }
}

function buildAuditLines(sig: SignatureDetails): string[] {
  const lines: string[] = [];
  if (sig.signedAtIso) {
    const d = new Date(sig.signedAtIso);
    if (!Number.isNaN(d.getTime())) lines.push(`Executed: ${d.toUTCString()}`);
  }
  if (sig.method) lines.push(`Method: ${sig.method}`);
  if (sig.ip) lines.push(`IP: ${String(sig.ip).slice(0, 45)}`);
  if (sig.userAgent) lines.push(`Device: ${String(sig.userAgent).slice(0, 70)}`);
  return lines;
}

function drawSignatureBlock(
  pdf: Doc,
  CW: number,
  bottom: number,
  agreement: AgreementContext,
  sig: SignatureDetails,
) {
  ensureSpace(pdf, bottom, 210);
  pdf.moveDown(0.6);

  const dy = pdf.y;
  pdf.moveTo(M, dy).lineTo(M + CW, dy).strokeColor(C.border).lineWidth(1).stroke();
  pdf.moveDown(0.7);
  pdf.font("Helvetica-Bold").fontSize(8).fillColor(C.signal).text("IN WITNESS WHEREOF", M, pdf.y, {
    characterSpacing: 1,
    width: CW,
  });
  pdf.moveDown(0.25);
  pdf
    .font("Helvetica")
    .fontSize(9)
    .fillColor(C.gray)
    .text("The parties have executed this Agreement as of the date signed below.", M, pdf.y, {
      width: CW,
    });
  pdf.moveDown(1);

  const colW = (CW - 28) / 2;
  const leftX = M;
  const rightX = M + colW + 28;
  const topY = pdf.y;

  pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(C.muted);
  pdf.text("SERVICE PROVIDER", leftX, topY, { width: colW, characterSpacing: 0.6 });
  pdf.text("CUSTOMER", rightX, topY, { width: colW, characterSpacing: 0.6 });

  const lineY = topY + 50;
  pdf.moveTo(leftX, lineY).lineTo(leftX + colW, lineY).strokeColor(C.ink).lineWidth(0.75).stroke();
  pdf.moveTo(rightX, lineY).lineTo(rightX + colW, lineY).strokeColor(C.ink).lineWidth(0.75).stroke();

  pdf
    .font("Helvetica-Oblique")
    .fontSize(16)
    .fillColor(C.ink)
    .text(agreement.provider.signatoryName, leftX, lineY - 24, { width: colW });

  if (sig.signaturePng && sig.signaturePng.length) {
    try {
      pdf.image(Buffer.from(sig.signaturePng), rightX, lineY - 34, {
        fit: [colW, 30],
      });
    } catch {
      pdf
        .font("Helvetica-Oblique")
        .fontSize(16)
        .fillColor(C.ink)
        .text(sig.signerName, rightX, lineY - 24, { width: colW });
    }
  }

  const detail = (x: number, name: string, title: string, dateStr: string) => {
    let yy = lineY + 6;
    pdf.font("Helvetica-Bold").fontSize(9.5).fillColor(C.ink).text(name || "—", x, yy, { width: colW });
    yy += 14;
    pdf.font("Helvetica").fontSize(8.5).fillColor(C.gray).text(title || "—", x, yy, { width: colW });
    yy += 13;
    pdf.font("Helvetica").fontSize(8.5).fillColor(C.gray).text(`Date: ${formatDate(dateStr)}`, x, yy, {
      width: colW,
    });
  };
  detail(leftX, agreement.provider.signatoryName, agreement.provider.signatoryTitle, sig.signedAt);
  detail(rightX, sig.signerName, sig.signerTitle || "—", sig.signedAt);

  const auditLines = buildAuditLines(sig);
  if (auditLines.length) {
    const ay = lineY + 64;
    pdf.roundedRect(M, ay, CW, 34, 5).fill(C.shade);
    pdf
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor(C.signal)
      .text("ELECTRONIC SIGNATURE AUDIT", M + 12, ay + 8, { width: CW - 24, characterSpacing: 0.6 });
    pdf
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(C.gray)
      .text(auditLines.join("     ·     "), M + 12, ay + 19, { width: CW - 24, lineGap: 1 });
  }
}

function drawFooters(pdf: Doc, W: number, provider: ContractProvider) {
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    pdf.switchToPage(i);
    const fy = pdf.page.height - FOOTER_H;
    pdf.moveTo(M, fy).lineTo(W - M, fy).strokeColor(C.border).lineWidth(0.5).stroke();
    pdf
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(`${provider.legalName} · Cleaning Services Agreement`, M, fy + 12, {
        width: (W - M * 2) * 0.7,
      });
    pdf
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(`Page ${i - range.start + 1} of ${range.count}`, W - M - 120, fy + 12, {
        width: 120,
        align: "right",
      });
  }
}

/**
 * Render a signed cleaning services agreement PDF. Returns the bytes; the caller
 * stores them in Storage and/or streams them. Nothing is persisted here.
 */
export function generateContractPdf(
  agreement: AgreementContext,
  sig: SignatureDetails,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ size: "LETTER", margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const W = pdf.page.width;
    const CW = W - M * 2;
    const bottom = pdf.page.height - FOOTER_H - 14;

    drawLetterhead(pdf, W, agreement.provider);
    pdf.y = HEADER_H + 24;

    eyebrow(pdf, CW, "CLEANING SERVICES AGREEMENT");
    pdf.moveDown(0.5);
    pdf
      .fillColor(C.ink)
      .font("Helvetica-Bold")
      .fontSize(21)
      .text(agreement.customer.company, M, pdf.y, { width: CW, lineGap: 1 });
    if (agreement.customer.address) {
      pdf.moveDown(0.3);
      pdf
        .font("Helvetica")
        .fontSize(10)
        .fillColor(C.gray)
        .text(agreement.customer.address, M, pdf.y, { width: CW });
    }
    pdf.moveDown(1);

    drawSummaryStrip(pdf, CW, agreement);
    pdf.moveDown(1.2);

    pdf.fontSize(9.5).font("Helvetica").fillColor(C.body);
    const preamble =
      `This Cleaning Services Agreement ("Agreement") is entered into as of ` +
      `${formatDate(agreement.effectiveDate)} between ${agreement.provider.legalName} ` +
      `("${agreement.provider.shortName}") and ${agreement.customer.company} ` +
      `at ${agreement.customer.address} ("Customer").`;
    pdf.text(preamble, M, pdf.y, { align: "justify", lineGap: 3, width: CW });
    pdf.moveDown(1);

    agreement.sections.forEach((sec, idx) => {
      ensureSpace(pdf, bottom, 70);
      pdf
        .font("Helvetica-Bold")
        .fontSize(10.5)
        .fillColor(C.signal)
        .text(`${idx + 1}.  ${sec.title}`, M, pdf.y, { lineGap: 1, width: CW });
      pdf.moveDown(0.35);
      pdf
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor(C.body)
        .text(sec.text, M, pdf.y, { align: "justify", lineGap: 3, width: CW });
      pdf.moveDown(0.9);
    });

    drawSignatureBlock(pdf, CW, bottom, agreement, sig);
    drawFooters(pdf, W, agreement.provider);

    pdf.end();
  });
}

/** Decode a `data:image/png;base64,...` signature data URL into PNG bytes. */
export function decodeSignaturePng(dataUrl: string | null | undefined): Uint8Array | null {
  const PNG_PREFIX = "data:image/png;base64,";
  if (!dataUrl || !dataUrl.startsWith(PNG_PREFIX)) return null;
  const b64 = dataUrl.slice(PNG_PREFIX.length);
  try {
    return new Uint8Array(Buffer.from(b64, "base64"));
  } catch {
    return null;
  }
}

/** Suggested download filename for a signed agreement PDF. */
export function contractPdfFilename(company: string | null | undefined): string {
  const slug = String(company || "client")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48);
  return `Cleaning-Agreement-${slug || "client"}.pdf`;
}
