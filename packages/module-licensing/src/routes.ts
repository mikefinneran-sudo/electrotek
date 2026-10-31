import "server-only";
import { licensePatch } from "./lifecycle";
import {
  createLicense,
  deleteLicenseDocument,
  getLicense,
  listDocuments,
  listLicenseExpiryAlerts,
  listLicenses,
  listRenewals,
  recordRenewal,
  updateLicense,
} from "./server";
import type {
  CreateLicenseInput,
  LicenseDocumentKind,
  LicenseHolderType,
} from "./types";

export interface LicensesRouteOptions {
  /**
   * Called before EVERY handler. Return true to allow the request. When absent,
   * all requests are rejected with 401.
   */
  authorize?: (
    request: Request,
    method: "GET" | "POST" | "PATCH",
  ) => boolean | Promise<boolean>;
}

function unauthorized(): Response {
  return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
}

function deleteAuditFields(body: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...body };
  delete sanitized.recorded_by;
  delete sanitized.recorded_at;
  delete sanitized.uploaded_by;
  delete sanitized.uploaded_at;
  return sanitized;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    if (value == null) return null;
    return String(value);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  const text = stringOrNull(value);
  return text === null ? null : Number(text);
}

function licenseFromBody(body: Record<string, unknown>): CreateLicenseInput {
  const holderType = (stringOrNull(body.holder_type) ?? "staff") as LicenseHolderType;

  return {
    holder_type: holderType,
    staff_holder_id: holderType === "staff" ? stringOrNull(body.staff_holder_id) : null,
    asset_holder_id: holderType === "asset" ? stringOrNull(body.asset_holder_id) : null,
    license_name: stringOrNull(body.license_name) ?? "",
    issuing_authority: stringOrNull(body.issuing_authority) ?? "",
    jurisdiction: stringOrNull(body.jurisdiction),
    license_number: stringOrNull(body.license_number),
    issued_date: stringOrNull(body.issued_date),
    expiry_date: stringOrNull(body.expiry_date),
    renewal_window_days: numberOrNull(body.renewal_window_days) ?? 60,
    ceu_hours_required: numberOrNull(body.ceu_hours_required),
    notes: stringOrNull(body.notes),
  };
}

function badRequest(result: { errors?: string[] }): Response {
  return Response.json({ ok: false, errors: result.errors }, { status: 400 });
}

export function createLicensesRouteHandlers(options: LicensesRouteOptions = {}) {
  const authorized = (request: Request, method: "GET" | "POST" | "PATCH") =>
    options.authorize ? Promise.resolve(options.authorize(request, method)) : Promise.resolve(false);

  return {
    async GET(request: Request): Promise<Response> {
      if (!(await authorized(request, "GET"))) return unauthorized();

      const now = new Date();
      const id = new URL(request.url).searchParams.get("id");
      if (id) {
        const license = await getLicense(id, now);
        if (!license) return Response.json({ error: "Not found" }, { status: 404 });
        const [renewals, documents] = await Promise.all([listRenewals(id), listDocuments(id)]);
        return Response.json({ license, renewals, documents });
      }

      const [licenses, alerts] = await Promise.all([
        listLicenses(now),
        listLicenseExpiryAlerts(now),
      ]);
      return Response.json({ licenses, alerts });
    },

    async POST(request: Request): Promise<Response> {
      if (!(await authorized(request, "POST"))) return unauthorized();

      const body = deleteAuditFields((await request.json()) as Record<string, unknown>);
      const result = await createLicense(licenseFromBody(body));
      return result.ok ? Response.json({ ok: true, id: result.id }) : badRequest(result);
    },

    async PATCH(request: Request): Promise<Response> {
      if (!(await authorized(request, "PATCH"))) return unauthorized();

      const body = deleteAuditFields((await request.json()) as Record<string, unknown>);
      const action = stringOrNull(body.action) ?? "";

      if (action === "update") {
        const id = stringOrNull(body.id);
        if (!id) return Response.json({ error: "id is required" }, { status: 400 });
        const result = await updateLicense(id, licensePatch((field) => (field in body ? body[field] : undefined)));
        return result.ok ? Response.json({ ok: true, id: result.id }) : badRequest(result);
      }

      if (action === "renew") {
        const result = await recordRenewal({
          license_id: stringOrNull(body.license_id) ?? "",
          renewed_on: stringOrNull(body.renewed_on) ?? "",
          new_expiry_date: stringOrNull(body.new_expiry_date),
          ceu_hours_completed: numberOrNull(body.ceu_hours_completed),
          notes: stringOrNull(body.notes),
        });
        return result.ok ? Response.json({ ok: true, id: result.id }) : badRequest(result);
      }

      if (action === "delete_document") {
        const id = stringOrNull(body.document_id);
        if (!id) return Response.json({ error: "document_id is required" }, { status: 400 });
        const result = await deleteLicenseDocument(id);
        return result.ok ? Response.json({ ok: true, id: result.id }) : badRequest(result);
      }

      if (action === "create_document") {
        return Response.json(
          {
            error:
              "Use the upload Server Action for license documents so multipart files stay off JSON routes.",
          },
          { status: 400 },
        );
      }

      return Response.json({ error: `Unknown action "${action}"` }, { status: 400 });
    },
  };
}

export type { LicenseDocumentKind };
