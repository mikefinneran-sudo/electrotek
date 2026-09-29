// Route-handler factory for /api/visit. Mirrors the quote-engine's
// createInspectionRouteHandlers factory style. The consuming app re-exports the
// returned GET/POST from app/api/visit/route.ts.
//
//   GET   load an inspection's active checklist + items + visit history
//         (?inspectionId=...&generate=1 generates the checklist if missing)
//   POST  ?action=visit-signoff  submit a visit signoff (+ item completions)
//   POST  ?action=visit-photo-upload  upload a before/after photo to Storage
//
// Every handler is deny-by-default: with no authorize callback wired by the app,
// every request is rejected. These are all crew/staff routes served via the
// RLS-bypassing service-role client, so the route layer is the only gate.

import {
  createVisitSignoff,
  generateChecklistFromInspection,
  getChecklistWithItems,
  getSignedPhotoUrl,
  isVisitCheckflowConfigured,
  listVisits,
  uploadVisitPhoto,
  type VisitItemInput,
  type VisitSignoffInput,
} from "./server";

export type VisitRouteMethod = "GET" | "POST";

export interface VisitRouteOptions {
  /**
   * Called before EVERY handler. Return true to allow the request. When absent,
   * all requests are rejected with 401 — there is no safe default for crew/staff
   * resources backed by the RLS-bypassing service-role client. The consuming app
   * wires in whatever auth it has (a shared-secret header now, a crew/staff
   * session once the admin/crew module ships).
   */
  authorize?: (
    request: Request,
    method: VisitRouteMethod,
  ) => boolean | Promise<boolean>;
  /** Max photo upload size in bytes. Defaults to 10 MB. */
  maxPhotoBytes?: number;
}

const DEFAULT_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** ABC's idempotency-key shape: 8–80 chars of URL-safe id characters. */
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

/** Canonical UUID shape. visit_id must be a UUID before any Storage write. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SIGNED_BY_LENGTH = 200;
const MAX_NOTES_LENGTH = 4000;
const MAX_ITEM_NOTE_LENGTH = 1000;

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
      error: "Visit checkflow is not configured. Contact your administrator.",
    },
    { status: 503 },
  );
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function normalizeItemInputs(raw: unknown): VisitItemInput[] {
  if (!Array.isArray(raw)) return [];
  const result: VisitItemInput[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const idRaw = r.checklist_item_id ?? r.id;
    const id = idRaw == null || idRaw === "" ? null : Number(idRaw);
    result.push({
      checklist_item_id: id != null && Number.isFinite(id) ? id : null,
      done: r.done === true,
      note: typeof r.note === "string" ? r.note.slice(0, MAX_ITEM_NOTE_LENGTH) : null,
      active: r.active !== false,
    });
  }
  return result;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function createVisitRouteHandlers(options: VisitRouteOptions) {
  const maxPhotoBytes = options.maxPhotoBytes ?? DEFAULT_MAX_PHOTO_BYTES;

  const authorized = (request: Request, method: VisitRouteMethod) =>
    options.authorize
      ? Promise.resolve(options.authorize(request, method))
      : Promise.resolve(false);

  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isVisitCheckflowConfigured()) return setupRequired();

    const url = new URL(request.url);
    const inspectionId = url.searchParams.get("inspectionId") ?? url.searchParams.get("id");
    if (!inspectionId) {
      return json({ ok: false, error: "An inspection id is required." }, { status: 400 });
    }
    if (!isUuid(inspectionId)) {
      return json({ ok: false, error: "Invalid inspection id." }, { status: 400 });
    }

    let checklist = await getChecklistWithItems(inspectionId);
    if (!checklist && url.searchParams.get("generate") === "1") {
      checklist = await generateChecklistFromInspection(inspectionId);
    }

    const visits = await listVisits(inspectionId);

    return json({
      ok: true,
      inspectionId,
      checklist: checklist?.checklist ?? null,
      items: checklist?.items ?? [],
      visits,
    });
  }

  async function handleVisitSignoff(request: Request): Promise<Response> {
    const body = await readJsonBody(request);
    const inspectionId = typeof body.inspection_id === "string" ? body.inspection_id : undefined;
    if (!inspectionId) {
      return json({ ok: false, error: "An inspection id is required." }, { status: 400 });
    }
    if (!isUuid(inspectionId)) {
      return json({ ok: false, error: "Invalid inspection id." }, { status: 400 });
    }

    const checklistId =
      typeof body.checklist_id === "string" && body.checklist_id !== ""
        ? body.checklist_id
        : null;
    if (checklistId !== null && !isUuid(checklistId)) {
      return json({ ok: false, error: "Invalid checklist id." }, { status: 400 });
    }

    const signedBy = typeof body.signed_by === "string" ? body.signed_by : null;
    if (signedBy !== null && signedBy.length > MAX_SIGNED_BY_LENGTH) {
      return json({ ok: false, error: "Signer name is too long." }, { status: 400 });
    }

    const notes = typeof body.notes === "string" ? body.notes : null;
    if (notes !== null && notes.length > MAX_NOTES_LENGTH) {
      return json({ ok: false, error: "Notes are too long." }, { status: 400 });
    }

    const submissionId =
      typeof body.submission_id === "string" ? body.submission_id : null;
    if (submissionId !== null && !SUBMISSION_ID_PATTERN.test(submissionId)) {
      return json({ ok: false, error: "Invalid submission id." }, { status: 400 });
    }

    const input: VisitSignoffInput = {
      inspection_id: inspectionId,
      checklist_id: checklistId,
      signed_by: signedBy,
      visit_date: typeof body.visit_date === "string" ? body.visit_date : null,
      notes,
      submission_id: submissionId,
      items: normalizeItemInputs(body.items),
    };

    const visit = await createVisitSignoff(input);
    if (!visit) {
      return json({ ok: false, error: "Could not save the visit signoff." }, { status: 500 });
    }
    return json({ ok: true, id: visit.id, visit }, { status: 201 });
  }

  async function handleVisitPhotoUpload(request: Request): Promise<Response> {
    const formData = await request.formData().catch(() => undefined);
    if (!formData) {
      return json({ ok: false, error: "A multipart form upload is required." }, { status: 400 });
    }

    const visitId = formData.get("visit_id");
    const file = formData.get("file");
    if (typeof visitId !== "string" || !visitId) {
      return json({ ok: false, error: "A visit id is required." }, { status: 400 });
    }
    // Validate the id shape BEFORE any Storage write — the upload happens before
    // the DB insert, so a non-UUID id would otherwise write bytes to a crafted
    // object path.
    if (!UUID_PATTERN.test(visitId)) {
      return json({ ok: false, error: "Invalid visit id." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return json({ ok: false, error: "A photo file is required." }, { status: 400 });
    }
    if (file.size > maxPhotoBytes) {
      return json({ ok: false, error: "Photo is too large." }, { status: 413 });
    }
    const contentType = file.type || "image/jpeg";
    if (!ALLOWED_PHOTO_TYPES.has(contentType)) {
      return json({ ok: false, error: "Unsupported image type." }, { status: 415 });
    }

    const roleRaw = formData.get("role");
    const body = await file.arrayBuffer();
    const photo = await uploadVisitPhoto({
      visit_id: visitId,
      role: typeof roleRaw === "string" ? roleRaw : null,
      filename: file.name || null,
      content_type: contentType,
      size: file.size,
      body,
    });

    if (photo && "atCap" in photo) {
      return json(
        {
          ok: false,
          atCap: true,
          error: "This visit already has the maximum number of photos.",
        },
        { status: 409 },
      );
    }

    if (!photo) {
      // Storage/bucket unavailable — degrade gracefully rather than 500.
      return json(
        {
          ok: false,
          storageUnavailable: true,
          error: "Photo storage is not available. The visit was still recorded.",
        },
        { status: 503 },
      );
    }

    const signedUrl = photo.storage_path ? await getSignedPhotoUrl(photo.storage_path) : null;
    return json({ ok: true, photo, signedUrl }, { status: 201 });
  }

  async function POST(request: Request): Promise<Response> {
    if (!(await authorized(request, "POST"))) return unauthorized();
    if (!isVisitCheckflowConfigured()) return setupRequired();

    const action = new URL(request.url).searchParams.get("action") ?? "visit-signoff";
    if (action === "visit-photo-upload") return handleVisitPhotoUpload(request);
    if (action === "visit-signoff") return handleVisitSignoff(request);
    return json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  return { GET, POST };
}
