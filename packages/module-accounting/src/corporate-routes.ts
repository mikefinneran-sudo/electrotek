import "server-only";

import type { AuditActor } from "@waltersignal/bananaforce-data-supabase/audit";
import {
  deleteCorporateDocument,
  deleteCorporateFiling,
  deleteCorporateRegistration,
  getCorporateDocumentDownloadUrl,
  getCorporateSnapshot,
  isCorporateInfoConfigured,
  markCorporateFilingFiled,
  uploadCorporateDocument,
  upsertCorporateFiling,
  upsertCorporateProfile,
  upsertCorporateRegistration,
} from "./corporate";
import { CORPORATE_DOC_TYPES } from "./corporate-logic";
import type { CorporateDocType, CorporateEntityType, FilingFrequency, RegistrationKind, RegistrationStatus } from "./types";

export interface CorporateInfoRouteOptions {
  authorize?: (
    request: Request,
    method: "GET" | "POST",
  ) => boolean | Promise<boolean>;
  /** Staff identity for audit_log rows, updated_by and uploaded_by. */
  getActor?: () => Promise<AuditActor | null>;
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
      error: "Corporate info is not configured. Contact your administrator.",
    },
    { status: 503 },
  );
}

function badRequest(error: string): Response {
  return json({ ok: false, error }, { status: 400 });
}

function isValidUuid(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  const body = await request.json().catch(() => ({}));
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

export function createCorporateInfoRouteHandlers(options: CorporateInfoRouteOptions = {}) {
  const authorized = (request: Request, method: "GET" | "POST") =>
    options.authorize ? Promise.resolve(options.authorize(request, method)) : Promise.resolve(false);

  const actor = async () => (options.getActor ? (await options.getActor()) ?? undefined : undefined);

  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isCorporateInfoConfigured()) return setupRequired();

    const url = new URL(request.url);
    const resource = url.searchParams.get("resource") ?? "snapshot";

    if (resource === "download") {
      const documentId = url.searchParams.get("document_id");
      if (!isValidUuid(documentId)) {
        return badRequest("document_id must be a UUID.");
      }
      const result = await getCorporateDocumentDownloadUrl(documentId!);
      return result.ok ? json({ ok: true, url: result.url }) : badRequest(result.error);
    }

    const snapshot = await getCorporateSnapshot();
    if (!snapshot) {
      return json({ ok: false, error: "Could not load corporate info." }, { status: 500 });
    }
    return json({ ok: true, ...snapshot });
  }

  async function POST(request: Request): Promise<Response> {
    if (!(await authorized(request, "POST"))) return unauthorized();
    if (!isCorporateInfoConfigured()) return setupRequired();

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData().catch(() => null);
      if (!formData) return badRequest("Invalid form data.");

      const action = String(formData.get("action") ?? "");
      if (action === "upload-document") {
        const file = formData.get("file");
        if (!(file instanceof File)) return badRequest("file is required.");
        const docType = String(formData.get("doc_type") ?? "");
        if (!CORPORATE_DOC_TYPES.includes(docType as CorporateDocType)) {
          return badRequest("doc_type is invalid.");
        }
        const registrationId = String(formData.get("registration_id") ?? "").trim() || null;
        if (registrationId && !isValidUuid(registrationId)) {
          return badRequest("registration_id must be a UUID.");
        }
        const result = await uploadCorporateDocument(
          {
            file,
            doc_type: docType as CorporateDocType,
            registration_id: registrationId,
          },
          await actor(),
        );
        return result.ok
          ? json({ ok: true, document: result.document }, { status: 201 })
          : badRequest(result.error);
      }

      return badRequest("Unknown multipart action.");
    }

    const body = await readJsonBody(request);
    const action = String(body.action ?? "");

    if (action === "upsert-profile") {
      // Enum fields pass through unchanged: the server functions reject an
      // invalid value with 400 rather than silently coercing it.
      const result = await upsertCorporateProfile(
        {
          legal_name: body.legal_name as string | null | undefined,
          dba_names: Array.isArray(body.dba_names) ? body.dba_names.map(String) : undefined,
          entity_type: body.entity_type as CorporateEntityType | null | undefined,
          tax_classification: body.tax_classification as string | null | undefined,
          ein: body.ein as string | null | undefined,
          formation_state: body.formation_state as string | null | undefined,
          formation_date: body.formation_date as string | null | undefined,
          sos_entity_number: body.sos_entity_number as string | null | undefined,
          registered_agent_name: body.registered_agent_name as string | null | undefined,
          registered_agent_address: body.registered_agent_address as string | null | undefined,
          principal_address: body.principal_address as string | null | undefined,
          mailing_address: body.mailing_address as string | null | undefined,
          fiscal_year_end: body.fiscal_year_end as string | null | undefined,
          naics_code: body.naics_code as string | null | undefined,
          duns_or_uei: body.duns_or_uei as string | null | undefined,
          notes: body.notes as string | null | undefined,
        },
        await actor(),
      );
      return result.ok ? json({ ok: true, profile: result.profile }) : badRequest(result.error);
    }

    if (action === "upsert-registration") {
      if (body.id !== undefined && !isValidUuid(body.id)) return badRequest("id must be a UUID.");
      const result = await upsertCorporateRegistration(
        {
          id: body.id as string | undefined,
          jurisdiction: String(body.jurisdiction ?? ""),
          kind: body.kind as RegistrationKind,
          label: String(body.label ?? ""),
          identifier: body.identifier as string | null | undefined,
          agency_name: body.agency_name as string | null | undefined,
          portal_url: body.portal_url as string | null | undefined,
          onepassword_ref: body.onepassword_ref as string | null | undefined,
          effective_date: body.effective_date as string | null | undefined,
          status: body.status as RegistrationStatus | undefined,
          notes: body.notes as string | null | undefined,
        },
        await actor(),
      );
      return result.ok ? json({ ok: true, registration: result.registration }) : badRequest(result.error);
    }

    if (action === "delete-registration") {
      if (!isValidUuid(body.id)) return badRequest("id must be a UUID.");
      const result = await deleteCorporateRegistration(String(body.id), await actor());
      return result.ok ? json({ ok: true }) : badRequest(result.error);
    }

    if (action === "upsert-filing") {
      if (body.id !== undefined && !isValidUuid(body.id)) return badRequest("id must be a UUID.");
      if (body.registration_id != null && !isValidUuid(body.registration_id)) {
        return badRequest("registration_id must be a UUID.");
      }
      const result = await upsertCorporateFiling(
        {
          id: body.id as string | undefined,
          registration_id: body.registration_id as string | null | undefined,
          jurisdiction: String(body.jurisdiction ?? ""),
          name: String(body.name ?? ""),
          frequency: body.frequency as FilingFrequency,
          next_due_date: body.next_due_date as string | null | undefined,
          last_filed_date: body.last_filed_date as string | null | undefined,
          last_confirmation: body.last_confirmation as string | null | undefined,
          portal_url: body.portal_url as string | null | undefined,
          notes: body.notes as string | null | undefined,
        },
        await actor(),
      );
      return result.ok ? json({ ok: true, filing: result.filing }) : badRequest(result.error);
    }

    if (action === "mark-filed") {
      if (!isValidUuid(body.id)) return badRequest("id must be a UUID.");
      const result = await markCorporateFilingFiled(
        String(body.id),
        {
          filedDate: typeof body.filed_date === "string" ? body.filed_date : undefined,
          confirmation: body.confirmation as string | null | undefined,
        },
        await actor(),
      );
      return result.ok ? json({ ok: true, filing: result.filing }) : badRequest(result.error);
    }

    if (action === "delete-filing") {
      if (!isValidUuid(body.id)) return badRequest("id must be a UUID.");
      const result = await deleteCorporateFiling(String(body.id), await actor());
      return result.ok ? json({ ok: true }) : badRequest(result.error);
    }

    if (action === "delete-document") {
      if (!isValidUuid(body.id)) return badRequest("id must be a UUID.");
      const result = await deleteCorporateDocument(String(body.id), await actor());
      return result.ok ? json({ ok: true }) : badRequest(result.error);
    }

    return badRequest("Unknown action.");
  }

  return { GET, POST };
}
