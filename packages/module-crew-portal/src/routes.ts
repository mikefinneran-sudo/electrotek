// Route-handler factory for /api/crew. Mirrors quote-engine/admin: a
// deny-by-default `authorize` gate fronts EVERY handler, because all crew
// operations run through the RLS-bypassing service-role client and the route
// layer is the only edge gate. The consuming app re-exports the returned
// GET/PATCH from app/api/crew/route.ts and wires `authorize: () =>
// isStaffRequest()` (the real staff-session check from ./auth).
//
//   GET   ?view=dashboard | leads[&status=] | pipeline | client&id=<uuid>
//   PATCH { entity: 'lead', id, status }
//         { entity: 'inspection', id, status?, internal_notes? }
//
// The gate + server functions enforce the staff/service-role boundary.

import "server-only";
import {
  getClientDetail,
  getDashboard,
  isCrewPortalConfigured,
  isInspectionStatus,
  isLeadStatus,
  isUuid,
  listLeads,
  listPipeline,
  updateInspectionStatus,
  updateLeadStatus,
} from "./server";
import type { InspectionStatus, LeadStatus } from "./types";

const MAX_PATCH_BODY_BYTES = 64 * 1024;

export interface CrewRouteOptions {
  /**
   * Called before EVERY handler. Return true to allow the request. When absent,
   * all requests are rejected with 401 — there is no safe default for a
   * staff-only resource backed by the RLS-bypassing service-role client. The
   * consuming app wires in the real staff-session check: `() => isStaffRequest()`
   * from @waltersignal/bananaforce-module-crew-portal/auth.
   */
  authorize?: (
    request: Request,
    method: "GET" | "PATCH",
  ) => boolean | Promise<boolean>;
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
      error: "Crew portal is not configured. Contact your administrator.",
    },
    { status: 503 },
  );
}

function badRequest(error: string): Response {
  return json({ ok: false, error }, { status: 400 });
}

function notFound(error: string): Response {
  return json({ ok: false, error }, { status: 404 });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

export function createCrewRouteHandlers(options: CrewRouteOptions) {
  // Deny-by-default: with no authorize callback wired by the app, every request
  // is rejected. Crew portal is staff-only and served via the service-role
  // client (RLS is bypassed), so the route layer is the only gate.
  const authorized = (request: Request, method: "GET" | "PATCH") =>
    options.authorize
      ? Promise.resolve(options.authorize(request, method))
      : Promise.resolve(false);

  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isCrewPortalConfigured()) return setupRequired();

    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "dashboard";

    switch (view) {
      case "dashboard": {
        const dashboard = await getDashboard();
        return json({ ok: true, dashboard });
      }
      case "leads": {
        const statusParam = url.searchParams.get("status");
        const status: LeadStatus | undefined = isLeadStatus(statusParam)
          ? statusParam
          : undefined;
        const leads = await listLeads(status);
        return json({ ok: true, leads });
      }
      case "pipeline": {
        const pipeline = await listPipeline();
        return json({ ok: true, pipeline });
      }
      case "client": {
        const id = url.searchParams.get("id");
        if (!isUuid(id)) return badRequest("A valid inspection id is required.");
        const detail = await getClientDetail(id);
        if (!detail) return notFound("Client not found.");
        return json({ ok: true, detail });
      }
      default:
        return badRequest("Unknown view.");
    }
  }

  async function PATCH(request: Request): Promise<Response> {
    if (!(await authorized(request, "PATCH"))) return unauthorized();
    if (!isCrewPortalConfigured()) return setupRequired();

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_PATCH_BODY_BYTES) {
      return json({ ok: false, error: "Request body is too large." }, { status: 413 });
    }

    const body = await readJson(request);
    const entity = typeof body.entity === "string" ? body.entity : "";
    const id = typeof body.id === "string" ? body.id : "";
    if (!isUuid(id)) return badRequest("A valid id is required.");

    switch (entity) {
      case "lead": {
        if (!isLeadStatus(body.status)) {
          return badRequest("A valid lead status is required.");
        }
        const lead = await updateLeadStatus(id, body.status);
        if (!lead) return notFound("Could not update the lead.");
        return json({ ok: true, lead });
      }
      case "inspection": {
        const patch: { status?: InspectionStatus; internal_notes?: string | null } = {};
        if ("status" in body) {
          if (!isInspectionStatus(body.status)) {
            return badRequest("A valid inspection status is required.");
          }
          patch.status = body.status;
        }
        if ("internal_notes" in body) {
          const notes = body.internal_notes;
          patch.internal_notes = notes == null ? null : String(notes);
        }
        if (Object.keys(patch).length === 0) {
          return badRequest("No inspection fields to update.");
        }
        const inspection = await updateInspectionStatus(id, patch);
        if (!inspection) return notFound("Could not update the inspection.");
        return json({ ok: true, inspection });
      }
      default:
        return badRequest("Unknown entity.");
    }
  }

  return { GET, PATCH };
}
