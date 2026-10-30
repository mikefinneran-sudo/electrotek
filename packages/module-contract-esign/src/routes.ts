// Route-handler factories for the contract-esign module. Mirrors the quote-engine
// factory style (deny-by-default authorize for staff routes). Two surfaces:
//
//   createContractRouteHandlers({ provider, authorize })  — STAFF, /contract +
//     admin ops. Deny-by-default: with no authorize callback every request is
//     401. Used to list/load contracts and to mint a client sign link.
//
//   createSignRouteHandlers({ provider })  — CLIENT, /api/sign. Gated by a
//     server-verified signed token (src/tokens.ts), NOT by authorize:
//       GET  ?token=          load the agreement for the sign page
//       GET  ?token=&source=1 stream an uploaded source PDF
//       GET  ?token=&pdf=1    stream the executed PDF (once signed)
//       POST { token, signerName, signerTitle/address, signatureData } execute

import {
  buildAgreement,
  contractPdfFilename,
  decodeSignaturePng,
  generateContractPdf,
  type ContractProvider,
} from "./pdf";
import { appendSignaturePage, checkSourcePdf } from "./document-pdf";
import {
  afterDocumentSent,
  afterDocumentSigned,
  type ContractAutomationSettings,
  type ContractCrmLinks,
} from "./automation";
import { sendExecutedContractEmail } from "./email";
import {
  createContractForDocument,
  createContractForInspection,
  downloadFromContracts,
  getContract,
  getInspectionRef,
  isContractEsignConfigured,
  listContracts,
  markContractSent,
  markContractSigned,
  storeContractPdf,
  storeSignaturePng,
} from "./server";
import {
  createSignToken,
  isSignTokenConfigured,
  signPageUrl,
  verifySignToken,
} from "./tokens";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Vercel refuses request bodies over 4.5 MB before the function runs, so the
// advertised cap sits under it with room for the multipart envelope.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = 4.5 * 1024 * 1024;
const MAX_ADDRESS_LINES = 8;
const EMAIL_TIMEOUT_MS = 10_000;

function parseMoneyField(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function unauthorized(): Response {
  return json({ ok: false, error: "Unauthorized." }, { status: 401 });
}

function setupRequired(): Response {
  return json(
    {
      ok: false,
      setupRequired: true,
      error: "Contracts are not configured. Contact your administrator.",
    },
    { status: 503 },
  );
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  }
  const formData = await request.formData().catch(() => undefined);
  if (!formData) return {};
  return Object.fromEntries(formData.entries());
}

function clientIp(request: Request): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

// --- STAFF: /contract route handlers -------------------------------------

export interface ContractRouteOptions {
  /** Provider/brand details stamped onto generated agreements. */
  provider: ContractProvider;
  /**
   * Called before EVERY staff handler. Return true to allow. When absent, all
   * requests are rejected with 401 — there is no safe default for a staff-only
   * resource backed by the RLS-bypassing service-role client.
   */
  authorize?: (
    request: Request,
    method: "GET" | "POST",
  ) => boolean | Promise<boolean>;
  /** Additional real-staff gate for uploaded PDFs. Denied when absent. */
  authorizeUpload?: (request: Request) => boolean | Promise<boolean>;
  /** Origin used when building sign links (defaults to the request origin). */
  origin?: string;
  /** Sign-invite and deposit-invoice automation (Resend + billing when configured). */
  automation?: ContractAutomationSettings;
}

export function createContractRouteHandlers(options: ContractRouteOptions) {
  const authorized = (request: Request, method: "GET" | "POST") =>
    options.authorize
      ? Promise.resolve(options.authorize(request, method))
      : Promise.resolve(false);

  // GET ?id=  load one contract (+ inspection) ; otherwise list contracts.
  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isContractEsignConfigured()) return setupRequired();

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      const contracts = await listContracts();
      return json({ ok: true, contracts });
    }
    if (!UUID_RE.test(id)) {
      return json({ ok: false, error: "Contract not found." }, { status: 404 });
    }

    const contract = await getContract(id);
    if (!contract) return json({ ok: false, error: "Contract not found." }, { status: 404 });
    const inspection = contract.inspection_id
      ? await getInspectionRef(contract.inspection_id)
      : null;
    return json({ ok: true, contract, inspection });
  }

  // POST { inspectionId }  create-or-load the active contract for an inspection
  // and mint a client sign link. Idempotent: re-minting returns the same active
  // contract and a fresh (still-valid) token.
  async function POST(request: Request): Promise<Response> {
    if (!(await authorized(request, "POST"))) return unauthorized();
    const isMultipart = (request.headers.get("content-type") ?? "").includes(
      "multipart/form-data",
    );
    if (
      isMultipart &&
      !(options.authorizeUpload && (await options.authorizeUpload(request)))
    ) {
      return unauthorized();
    }
    if (!isContractEsignConfigured()) return setupRequired();
    if (!isSignTokenConfigured()) return setupRequired();

    if (isMultipart) {
      const tooLarge = () =>
        json({ ok: false, error: "The PDF is too large. The maximum size is 4 MB." }, { status: 413 });
      if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BODY_BYTES) {
        return tooLarge();
      }
      const formData = await request.formData().catch(() => undefined);
      if (!formData) {
        return json({ ok: false, error: "Could not read the upload." }, { status: 400 });
      }
      const file = formData.get("file");
      const title = typeof formData.get("title") === "string"
        ? String(formData.get("title")).trim()
        : "";
      const signerName = typeof formData.get("signerName") === "string"
        ? String(formData.get("signerName")).trim()
        : "";
      const signerEmail = typeof formData.get("signerEmail") === "string"
        ? String(formData.get("signerEmail")).trim()
        : "";
      const depositAmountDue = parseMoneyField(formData.get("depositAmountDue"));
      const finalAmountDue = parseMoneyField(formData.get("finalAmountDue"));
      const cardFeePassthrough = ["1", "true", "on"].includes(
        String(formData.get("cardFeePassthrough") ?? "").trim().toLowerCase(),
      );
      const crmOpportunityId = typeof formData.get("crmOpportunityId") === "string"
        ? String(formData.get("crmOpportunityId")).trim()
        : "";

      if (!(file instanceof File)) {
        return json({ ok: false, error: "Choose a PDF agreement to upload." }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) return tooLarge();
      if (!title || title.length > 200) {
        return json({ ok: false, error: "Enter a title of 200 characters or fewer." }, { status: 400 });
      }
      if (!signerName || signerName.length > 200) {
        return json(
          { ok: false, error: "Enter a signer name of 200 characters or fewer." },
          { status: 400 },
        );
      }
      if (
        !signerEmail ||
        signerEmail.length > 320 ||
        !/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(signerEmail)
      ) {
        return json({ ok: false, error: "Enter a valid signer email." }, { status: 400 });
      }
      if (crmOpportunityId && !UUID_RE.test(crmOpportunityId)) {
        return json({ ok: false, error: "Enter a valid CRM opportunity id." }, { status: 400 });
      }

      const pdfBytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(pdfBytes.subarray(0, 5)) !== "%PDF-") {
        return json({ ok: false, error: "The uploaded file is not a valid PDF." }, { status: 400 });
      }
      const unusable = await checkSourcePdf(pdfBytes);
      if (unusable) return json({ ok: false, error: unusable }, { status: 400 });

      let crmLinks: ContractCrmLinks | null = null;
      try {
        crmLinks = await options.automation?.crm?.resolve?.(signerEmail) ?? null;
      } catch {
        console.warn("[contract-esign] CRM resolution failed for document upload.");
      }
      const contract = await createContractForDocument({
        title,
        signerName,
        signerEmail,
        pdfBytes,
        depositAmountDue,
        finalAmountDue,
        cardFeePassthrough,
        crmAccountId: crmLinks?.accountId ?? null,
        crmContactId: crmLinks?.contactId ?? null,
        crmOpportunityId: crmOpportunityId || crmLinks?.opportunityId || null,
      });
      if (!contract) {
        return json({ ok: false, error: "Could not create the contract." }, { status: 500 });
      }

      let token: string;
      try {
        token = await createSignToken(contract.id);
      } catch {
        return setupRequired();
      }
      await markContractSent(contract.id);
      const origin = options.origin ?? new URL(request.url).origin;
      const signUrl = signPageUrl(token, origin);
      const invite = options.automation
        ? await afterDocumentSent({
            contract,
            signUrl,
            settings: options.automation,
          })
        : { signInviteSent: false };
      return json({
        ok: true,
        contract,
        token,
        signUrl,
        signInviteSent: invite.signInviteSent,
        ...("error" in invite && invite.error ? { signInviteError: invite.error } : {}),
      });
    }

    const body = await readBody(request);
    const inspectionId = typeof body.inspectionId === "string" ? body.inspectionId : undefined;
    if (!inspectionId) {
      return json({ ok: false, error: "An inspection id is required." }, { status: 400 });
    }
    if (!UUID_RE.test(inspectionId)) {
      return json({ ok: false, error: "An inspection id is required." }, { status: 400 });
    }

    const inspection = await getInspectionRef(inspectionId);
    if (!inspection) {
      return json({ ok: false, error: "Inspection not found." }, { status: 404 });
    }
    if (inspection.status !== "accepted") {
      return json(
        { ok: false, error: "Only accepted inspections can be converted to a contract." },
        { status: 422 },
      );
    }

    const contract = await createContractForInspection(inspectionId);
    if (!contract) {
      return json({ ok: false, error: "Could not create the contract." }, { status: 500 });
    }

    let token: string;
    try {
      token = await createSignToken(contract.id);
    } catch {
      return setupRequired();
    }
    await markContractSent(contract.id);

    const origin = options.origin ?? new URL(request.url).origin;
    return json({
      ok: true,
      contract,
      token,
      signUrl: signPageUrl(token, origin),
    });
  }

  return { GET, POST };
}

// --- CLIENT: /api/sign route handlers (token-gated) ----------------------

export interface SignRouteOptions {
  /** Provider/brand details stamped onto generated agreements. */
  provider: ContractProvider;
  /** Sign-invite and deposit-invoice automation (deposit runs after document sign). */
  automation?: ContractAutomationSettings;
  /** Origin used for pay links (defaults to the request origin). */
  origin?: string;
}

function tokenInvalid(): Response {
  // Generic — never reveal whether the contract exists or the token expired vs.
  // was malformed. A client with a bad/expired link sees the same message.
  return json(
    { ok: false, error: "This signing link is invalid or has expired." },
    { status: 401 },
  );
}

function documentPdfFilename(title: string | null | undefined): string {
  const slug = String(title || "Agreement")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `Executed-${slug || "Agreement"}.pdf`;
}

function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function createSignRouteHandlers(options: SignRouteOptions) {
  // GET ?token=        load agreement (+ already-signed flag)
  // GET ?token=&pdf=1  stream the executed PDF (signed contracts only)
  async function GET(request: Request): Promise<Response> {
    if (!isContractEsignConfigured()) return setupRequired();

    const url = new URL(request.url);
    const rawToken = url.searchParams.get("token");
    if (rawToken && rawToken.length > 2048) return tokenInvalid();
    const verified = await verifySignToken(rawToken);
    if (!verified) return tokenInvalid();

    const contract = await getContract(verified.contractId);
    if (!contract || contract.status === "void") return tokenInvalid();

    const wantsPdf = url.searchParams.get("pdf") === "1";
    const wantsSource = url.searchParams.get("source") === "1";

    if (contract.source_pdf_path) {
      if (wantsSource) {
        const source = await downloadFromContracts(contract.source_pdf_path);
        if (!source) {
          return json({ ok: false, error: "The source agreement is unavailable." }, { status: 404 });
        }
        return pdfResponse(source, documentPdfFilename(contract.title).replace("Executed-", ""));
      }

      if (wantsPdf) {
        if (contract.status !== "signed") {
          return json({ ok: false, error: "This agreement has not been signed yet." }, { status: 404 });
        }
        let bytes = contract.pdf_path
          ? await downloadFromContracts(contract.pdf_path)
          : null;
        if (!bytes) {
          const [source, signaturePng] = await Promise.all([
            downloadFromContracts(contract.source_pdf_path),
            contract.signature_path
              ? downloadFromContracts(contract.signature_path)
              : Promise.resolve(null),
          ]);
          if (!source || !signaturePng || !contract.signed_at) {
            return json({ ok: false, error: "The executed agreement is unavailable." }, { status: 404 });
          }
          bytes = await appendSignaturePage(source, {
            contractId: contract.id,
            title: contract.title ?? "Agreement",
            provider: options.provider,
            signerName: contract.signer_name ?? "",
            signerAddress: contract.signer_address ?? "",
            signaturePng,
            signedAtIso: contract.signed_at,
            ip: contract.signed_ip,
            userAgent: contract.signed_user_agent,
            method: contract.audit_method,
          });
        }
        return pdfResponse(bytes, documentPdfFilename(contract.title));
      }

      return json({
        ok: true,
        kind: "document",
        alreadySigned: contract.status === "signed",
        signedAt: contract.signed_at,
        signerName: contract.signer_name,
        title: contract.title,
        documentUrl: `/api/sign?token=${encodeURIComponent(rawToken ?? "")}&source=1`,
      });
    }

    if (!contract.inspection_id || wantsSource) return tokenInvalid();
    const inspection = await getInspectionRef(contract.inspection_id);
    if (!inspection) return tokenInvalid();

    if (wantsPdf) {
      if (contract.status !== "signed") {
        return json({ ok: false, error: "This agreement has not been signed yet." }, { status: 404 });
      }
      // Prefer the stored copy; regenerate on demand if Storage is unavailable
      // or the file is missing (degrade gracefully).
      let bytes: Uint8Array | null = contract.pdf_path
        ? await downloadFromContracts(contract.pdf_path)
        : null;
      if (!bytes) {
        const agreement = buildAgreement(inspection, options.provider);
        const sigPng = contract.signature_path
          ? await downloadFromContracts(contract.signature_path)
          : null;
        const pdf = await generateContractPdf(agreement, {
          signerName: contract.signer_name ?? "",
          signerTitle: contract.signer_title,
          signaturePng: sigPng,
          signedAt: (contract.signed_at ?? "").slice(0, 10),
          signedAtIso: contract.signed_at ?? undefined,
          ip: contract.signed_ip,
          userAgent: contract.signed_user_agent,
          method: contract.audit_method,
        });
        bytes = new Uint8Array(pdf);
      }
      return pdfResponse(bytes, contractPdfFilename(inspection.prospect_company));
    }

    const agreement = buildAgreement(inspection, options.provider);
    return json({
      ok: true,
      kind: "agreement",
      alreadySigned: contract.status === "signed",
      signedAt: contract.signed_at,
      signerName: contract.signer_name,
      company: inspection.prospect_company,
      address: inspection.office_address,
      agreement: {
        title: agreement.title,
        effectiveDate: agreement.effectiveDate,
        summary: agreement.summary,
        sections: agreement.sections,
        provider: {
          legalName: agreement.provider.legalName,
          shortName: agreement.provider.shortName,
        },
        customer: agreement.customer,
      },
    });
  }

  // POST { token, signerName, signerTitle, signatureData }  execute the sign.
  // Verify token → render PDF → store signature + PDF to Storage → mark signed.
  // Does NOT write quote-engine tables (inspection status is unchanged).
  async function POST(request: Request): Promise<Response> {
    if (!isContractEsignConfigured()) return setupRequired();

    const body = await readBody(request);
    const rawToken = typeof body.token === "string" ? body.token : null;
    // Cap the raw token before any crypto to bound memory/CPU on the public route.
    if (rawToken && rawToken.length > 2048) return tokenInvalid();
    const verified = await verifySignToken(rawToken);
    if (!verified) return tokenInvalid();

    const signerName =
      typeof body.signerName === "string" ? body.signerName.trim().slice(0, 200) : "";
    const signerTitle =
      typeof body.signerTitle === "string" ? body.signerTitle.trim().slice(0, 200) : "";
    const signerAddress =
      typeof body.signerAddress === "string" ? body.signerAddress.trim() : "";
    const signatureData = typeof body.signatureData === "string" ? body.signatureData : "";

    if (!signerName) {
      return json({ ok: false, error: "Please enter your printed name." }, { status: 400 });
    }
    const MAX_SIG_B64 = 512 * 1024;
    if (signatureData.length > MAX_SIG_B64) {
      return json({ ok: false, error: "Signature data is too large." }, { status: 400 });
    }
    const signaturePng = decodeSignaturePng(signatureData);
    if (!signaturePng) {
      return json({ ok: false, error: "Please provide your signature." }, { status: 400 });
    }

    const contract = await getContract(verified.contractId);
    if (!contract || contract.status === "void") return tokenInvalid();

    if (contract.source_pdf_path) {
      if (contract.status === "signed") {
        return json({
          ok: true,
          alreadySigned: true,
          signedAt: contract.signed_at,
          title: contract.title,
        });
      }
      if (
        !signerAddress ||
        signerAddress.length > 500 ||
        signerAddress.split("\n").length > MAX_ADDRESS_LINES
      ) {
        return json(
          {
            ok: false,
            error: `Please enter a mailing address of 500 characters and ${MAX_ADDRESS_LINES} lines or fewer.`,
          },
          { status: 400 },
        );
      }

      const source = await downloadFromContracts(contract.source_pdf_path);
      if (!source) {
        return json({ ok: false, error: "Could not load the source agreement." }, { status: 500 });
      }
      const signedAtIso = new Date().toISOString();
      const audit = {
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent"),
        method: "Client e-signature link",
      };
      let pdf: Uint8Array;
      try {
        pdf = await appendSignaturePage(source, {
          contractId: contract.id,
          title: contract.title ?? "Agreement",
          provider: options.provider,
          signerName,
          signerAddress,
          signaturePng,
          signedAtIso,
          ...audit,
        });
      } catch {
        return json({ ok: false, error: "Could not prepare the executed agreement." }, { status: 500 });
      }

      // Unlike the inspection flow, an uploaded agreement cannot be regenerated
      // without the stored signature, so both artifacts must persist before the
      // row is marked signed. Per-attempt paths keep a losing concurrent attempt
      // from leaving its PDF where the winning row points.
      const attempt = crypto.randomUUID();
      const sigPath = await storeSignaturePng(contract.id, signaturePng, attempt);
      const storedPdfPath = sigPath ? await storeContractPdf(contract.id, pdf, attempt) : null;
      if (!sigPath || !storedPdfPath) {
        return json({ ok: false, error: "Could not store the executed agreement." }, { status: 500 });
      }
      const signed = await markContractSigned(contract.id, {
        signerName,
        signerAddress,
        signaturePath: sigPath,
        pdfPath: storedPdfPath,
        signedAtIso,
        audit,
      });
      // A null result can mean the UPDATE committed but its response was lost;
      // the re-read lets that attempt still be recognised as the winner below.
      const recorded = signed ?? (await getContract(contract.id));
      if (recorded?.status === "void") return tokenInvalid();
      if (!recorded || recorded.status !== "signed") {
        return json({ ok: false, error: "Could not record the signature." }, { status: 500 });
      }
      // Another attempt won the race: report its execution and send nothing.
      if (recorded.pdf_path !== storedPdfPath) {
        return json({
          ok: true,
          alreadySigned: true,
          signedAt: recorded.signed_at,
          title: recorded.title,
        });
      }

      const notifyEmail = process.env.CONTRACT_NOTIFY_EMAIL ?? "mike@waltersignal.io";
      const recipients = [contract.signer_email, notifyEmail].filter(
        (v, i, all): v is string =>
          Boolean(v) && all.findIndex((o) => o?.toLowerCase() === v?.toLowerCase()) === i,
      );
      let emailed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          sendExecutedContractEmail({
            to: recipients,
            title: contract.title ?? "Agreement",
            signerName,
            pdf,
            filename: documentPdfFilename(contract.title),
          }),
          new Promise<{ ok: false }>((resolve) => {
            timer = setTimeout(() => resolve({ ok: false }), EMAIL_TIMEOUT_MS);
          }),
        ]);
        emailed = result.ok;
      } catch {
        // Signing is complete even if the optional notification cannot be sent.
      } finally {
        clearTimeout(timer);
      }

      if (options.automation && contract.source_pdf_path) {
        await afterDocumentSigned({
          contractId: contract.id,
          signerName,
          origin: options.origin ?? new URL(request.url).origin,
          settings: options.automation,
        });
      }

      return json({ ok: true, signedAt: recorded.signed_at, emailed });
    }

    if (!contract.inspection_id) return tokenInvalid();
    const inspection = await getInspectionRef(contract.inspection_id);
    if (!inspection) return tokenInvalid();

    // Idempotent: a contract already signed returns success without overwriting
    // the original execution's audit trail.
    if (contract.status === "signed") {
      return json({
        ok: true,
        alreadySigned: true,
        signedAt: contract.signed_at,
        company: inspection.prospect_company,
      });
    }

    const signedAtIso = new Date().toISOString();
    const agreement = buildAgreement(inspection, options.provider);
    const pdf = await generateContractPdf(agreement, {
      signerName,
      signerTitle,
      signaturePng,
      signedAt: signedAtIso.slice(0, 10),
      signedAtIso,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
      method: "Client e-signature link",
    });

    // Storage is best-effort: a null path means the bucket isn't provisioned yet.
    // The contract is still marked signed (with the audit trail), and the PDF is
    // regenerated on demand from the row on later GET ?pdf=1 requests.
    const sigPath = await storeSignaturePng(contract.id, signaturePng);
    const storedPdfPath = await storeContractPdf(contract.id, new Uint8Array(pdf));

    const signed = await markContractSigned(contract.id, {
      signerName,
      signerTitle,
      signaturePath: sigPath,
      pdfPath: storedPdfPath,
      signedAtIso,
      audit: {
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent"),
        method: "Client e-signature link",
      },
    });
    if (signed?.status === "void") return tokenInvalid();
    if (!signed) {
      return json({ ok: false, error: "Could not record the signature." }, { status: 500 });
    }

    return json({
      ok: true,
      signedAt: signed.signed_at,
      company: inspection.prospect_company,
    });
  }

  return { GET, POST };
}
