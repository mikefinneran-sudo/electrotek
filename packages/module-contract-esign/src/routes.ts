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
//       GET  ?token=&pdf=1    stream the executed PDF (once signed)
//       POST { token, signerName, signerTitle, signatureData }  execute the sign

import {
  buildAgreement,
  contractPdfFilename,
  decodeSignaturePng,
  generateContractPdf,
  type ContractProvider,
} from "./pdf";
import {
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
  /** Origin used when building sign links (defaults to the request origin). */
  origin?: string;
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
    const inspection = await getInspectionRef(contract.inspection_id);
    return json({ ok: true, contract, inspection });
  }

  // POST { inspectionId }  create-or-load the active contract for an inspection
  // and mint a client sign link. Idempotent: re-minting returns the same active
  // contract and a fresh (still-valid) token.
  async function POST(request: Request): Promise<Response> {
    if (!(await authorized(request, "POST"))) return unauthorized();
    if (!isContractEsignConfigured()) return setupRequired();
    if (!isSignTokenConfigured()) return setupRequired();

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
}

function tokenInvalid(): Response {
  // Generic — never reveal whether the contract exists or the token expired vs.
  // was malformed. A client with a bad/expired link sees the same message.
  return json(
    { ok: false, error: "This signing link is invalid or has expired." },
    { status: 401 },
  );
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

    const inspection = await getInspectionRef(contract.inspection_id);
    if (!inspection) return tokenInvalid();

    const wantsPdf = url.searchParams.get("pdf") === "1";
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
      // Copy into a fresh Uint8Array (ArrayBuffer-backed) so the bytes are a
      // valid BodyInit regardless of the source array's backing buffer type.
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${contractPdfFilename(inspection.prospect_company)}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const agreement = buildAgreement(inspection, options.provider);
    return json({
      ok: true,
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
