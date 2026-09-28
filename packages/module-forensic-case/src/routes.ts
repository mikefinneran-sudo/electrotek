// Route-handler factory for /api/forensic-case. A single endpoint is
// discriminated by ?entity= on GET/DELETE and an entity body field on
// POST/PATCH, matching the CRM module's wire shape.

import "server-only";
import {
  createForensicRecord,
  getForensicRecord,
  isForensicCaseConfigured,
  listForensicRecords,
  MAX_LIST_LIMIT,
  MAX_NAME,
  MAX_TEXT,
  patchForensicRecord,
  softDeleteForensicRecord,
  type ForensicListOptions,
} from "./server";
import {
  CONTACT_METHOD_KINDS,
  FORENSIC_ENTITIES,
  PARTICIPANT_TYPES,
  type AddressInput,
  type ClaimantInput,
  type ContactMethodInput,
  type DepositionInput,
  type EvidenceInput,
  type ForensicEntity,
  type ForensicInputMap,
  type ParticipantInput,
  type TimeEntryInput,
} from "./types";

type ForensicMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ForensicCaseRouteOptions {
  /** Deny-by-default authorization callback, invoked before every handler. */
  authorize?: (
    request: Request,
    method: ForensicMethod,
  ) => boolean | Promise<boolean>;
}

const VALID_ENTITIES = new Set<string>(FORENSIC_ENTITIES);
const VALID_ENTITY_LABEL = FORENSIC_ENTITIES.join("|");
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function capString(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  const result = String(value).slice(0, max);
  return result.length > 0 ? result : null;
}

export function parseListLimit(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(number)));
}

function pickUuid(body: Record<string, unknown>, field: string): string | null | undefined {
  if (!(field in body)) return undefined;
  return isUuid(body[field]) ? body[field] : null;
}

function pickDate(body: Record<string, unknown>, field: string): string | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value == null || value === "") return null;
  return typeof value === "string" && ISO_DATE_RE.test(value) ? value : undefined;
}

function pickNumber(body: Record<string, unknown>, field: string): number | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function pickBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function pickEvidenceInput(body: Record<string, unknown>): EvidenceInput {
  return {
    case_id: pickUuid(body, "case_id"),
    description:
      "description" in body ? capString(body.description, MAX_TEXT) : undefined,
    piece_count:
      "piece_count" in body ? capString(body.piece_count, MAX_NAME) : undefined,
    received_on: pickDate(body, "received_on"),
    report_on: pickDate(body, "report_on"),
    action: "action" in body ? capString(body.action, MAX_NAME) : undefined,
    action_on: pickDate(body, "action_on"),
    disposition_on: pickDate(body, "disposition_on"),
    disposition_method:
      "disposition_method" in body
        ? capString(body.disposition_method, MAX_NAME)
        : undefined,
    custodian_initials:
      "custodian_initials" in body
        ? capString(body.custodian_initials, MAX_NAME)
        : undefined,
    storage_location:
      "storage_location" in body
        ? capString(body.storage_location, MAX_NAME)
        : undefined,
    other_location:
      "other_location" in body ? capString(body.other_location, MAX_NAME) : undefined,
    response: "response" in body ? capString(body.response, MAX_TEXT) : undefined,
    results: "results" in body ? capString(body.results, MAX_TEXT) : undefined,
    returned_to:
      "returned_to" in body ? capString(body.returned_to, MAX_NAME) : undefined,
    xray_status:
      "xray_status" in body ? capString(body.xray_status, MAX_NAME) : undefined,
    xray_on: pickDate(body, "xray_on"),
    work_order_reference:
      "work_order_reference" in body
        ? capString(body.work_order_reference, MAX_NAME)
        : undefined,
  };
}

function pickClaimantInput(body: Record<string, unknown>): ClaimantInput {
  return {
    case_id: pickUuid(body, "case_id"),
    display_name:
      "display_name" in body ? capString(body.display_name, MAX_NAME) : undefined,
    first_name:
      "first_name" in body ? capString(body.first_name, MAX_NAME) : undefined,
    last_name: "last_name" in body ? capString(body.last_name, MAX_NAME) : undefined,
    status: "status" in body ? capString(body.status, MAX_NAME) : undefined,
    address_line_1:
      "address_line_1" in body ? capString(body.address_line_1, MAX_NAME) : undefined,
    address_line_2:
      "address_line_2" in body ? capString(body.address_line_2, MAX_NAME) : undefined,
    city: "city" in body ? capString(body.city, MAX_NAME) : undefined,
    state: "state" in body ? capString(body.state, MAX_NAME) : undefined,
    postal_code:
      "postal_code" in body ? capString(body.postal_code, MAX_NAME) : undefined,
    loss_date: pickDate(body, "loss_date"),
    email: "email" in body ? capString(body.email, MAX_NAME) : undefined,
    cell_phone:
      "cell_phone" in body ? capString(body.cell_phone, MAX_NAME) : undefined,
    home_phone:
      "home_phone" in body ? capString(body.home_phone, MAX_NAME) : undefined,
    work_phone:
      "work_phone" in body ? capString(body.work_phone, MAX_NAME) : undefined,
    work_extension:
      "work_extension" in body
        ? capString(body.work_extension, MAX_NAME)
        : undefined,
    instructions:
      "instructions" in body ? capString(body.instructions, MAX_TEXT) : undefined,
  };
}

function pickAddressInput(body: Record<string, unknown>): AddressInput {
  return {
    account_id: pickUuid(body, "account_id"),
    contact_id: pickUuid(body, "contact_id"),
    case_id: pickUuid(body, "case_id"),
    category: "category" in body ? capString(body.category, MAX_NAME) : undefined,
    line_1: "line_1" in body ? capString(body.line_1, MAX_NAME) : undefined,
    formatted_address:
      "formatted_address" in body
        ? capString(body.formatted_address, MAX_TEXT)
        : undefined,
    city: "city" in body ? capString(body.city, MAX_NAME) : undefined,
    state: "state" in body ? capString(body.state, MAX_NAME) : undefined,
    postal_code:
      "postal_code" in body ? capString(body.postal_code, MAX_NAME) : undefined,
  };
}

function pickContactMethodInput(body: Record<string, unknown>): ContactMethodInput {
  const kind = CONTACT_METHOD_KINDS.includes(body.kind as never)
    ? (body.kind as "phone" | "email")
    : undefined;
  const isPrimary = pickBoolean(body.is_primary);
  return {
    kind,
    contact_id: pickUuid(body, "contact_id"),
    account_id: pickUuid(body, "account_id"),
    label: "label" in body ? capString(body.label, MAX_NAME) : undefined,
    value: "value" in body ? capString(body.value, MAX_NAME) : undefined,
    extension:
      "extension" in body ? capString(body.extension, MAX_NAME) : undefined,
    ...(isPrimary !== undefined ? { is_primary: isPrimary } : {}),
  };
}

function pickParticipantInput(body: Record<string, unknown>): ParticipantInput {
  const participantType = PARTICIPANT_TYPES.includes(body.participant_type as never)
    ? (body.participant_type as "expert" | "attorney" | "contact")
    : undefined;
  return {
    participant_type: participantType,
    case_id: pickUuid(body, "case_id"),
    contact_id: pickUuid(body, "contact_id"),
    account_id: pickUuid(body, "account_id"),
    role: "role" in body ? capString(body.role, MAX_NAME) : undefined,
    notes: "notes" in body ? capString(body.notes, MAX_TEXT) : undefined,
  };
}

function pickDepositionInput(body: Record<string, unknown>): DepositionInput {
  return {
    case_id: pickUuid(body, "case_id"),
    deponent: "deponent" in body ? capString(body.deponent, MAX_NAME) : undefined,
    scheduled_on: pickDate(body, "scheduled_on"),
    description:
      "description" in body ? capString(body.description, MAX_TEXT) : undefined,
    display_text:
      "display_text" in body ? capString(body.display_text, MAX_TEXT) : undefined,
    location: "location" in body ? capString(body.location, MAX_NAME) : undefined,
  };
}

function pickTimeEntryInput(body: Record<string, unknown>): TimeEntryInput {
  return {
    case_id: pickUuid(body, "case_id"),
    staff_id: pickUuid(body, "staff_id"),
    entry_date: pickDate(body, "entry_date"),
    category: "category" in body ? capString(body.category, MAX_NAME) : undefined,
    description:
      "description" in body ? capString(body.description, MAX_TEXT) : undefined,
    hours: pickNumber(body, "hours"),
    hourly_rate: pickNumber(body, "hourly_rate"),
    multiplier: pickNumber(body, "multiplier"),
    invoice_number:
      "invoice_number" in body ? capString(body.invoice_number, MAX_NAME) : undefined,
    location: "location" in body ? capString(body.location, MAX_NAME) : undefined,
    billed_amount: pickNumber(body, "billed_amount"),
  };
}

export function pickForensicInput<E extends ForensicEntity>(
  entity: E,
  body: Record<string, unknown>,
): ForensicInputMap[E] {
  if (entity === "evidence") return pickEvidenceInput(body) as ForensicInputMap[E];
  if (entity === "claimants") return pickClaimantInput(body) as ForensicInputMap[E];
  if (entity === "addresses") return pickAddressInput(body) as ForensicInputMap[E];
  if (entity === "contact_methods") {
    return pickContactMethodInput(body) as ForensicInputMap[E];
  }
  if (entity === "participants") {
    return pickParticipantInput(body) as ForensicInputMap[E];
  }
  if (entity === "depositions") return pickDepositionInput(body) as ForensicInputMap[E];
  return pickTimeEntryInput(body) as ForensicInputMap[E];
}

function hasText(...values: unknown[]): boolean {
  return values.some((value) => typeof value === "string" && value.length > 0);
}

/** API validation is intentionally stricter than import-tolerant SQL nullability. */
export function validateForensicInput<E extends ForensicEntity>(
  entity: E,
  input: ForensicInputMap[E],
  creating: boolean,
): string | null {
  const row = input as Record<string, unknown>;

  if (entity === "evidence" && creating) {
    if (!isUuid(row.case_id)) return "case_id is required for evidence.";
    if (!hasText(row.description)) return "description is required for evidence.";
  }
  if (entity === "claimants" && creating) {
    if (!isUuid(row.case_id)) return "case_id is required for claimants.";
    if (!hasText(row.display_name, row.first_name, row.last_name)) {
      return "Provide a claimant name.";
    }
  }
  if (entity === "addresses" && creating) {
    if (!isUuid(row.account_id) && !isUuid(row.contact_id) && !isUuid(row.case_id)) {
      return "Provide account_id, contact_id, or case_id for addresses.";
    }
    if (!hasText(row.line_1, row.formatted_address, row.city)) {
      return "Provide address content.";
    }
  }
  if (entity === "contact_methods") {
    if (creating && !CONTACT_METHOD_KINDS.includes(row.kind as never)) {
      return "kind is required (phone|email).";
    }
    if (creating && !hasText(row.value)) return "value is required for contact methods.";
    if (creating && !isUuid(row.contact_id) && !isUuid(row.account_id)) {
      return "Provide contact_id or account_id for contact methods.";
    }
    if (row.kind === "email" && hasText(row.value) && !EMAIL_RE.test(String(row.value))) {
      return "value must be a valid email address when kind is email.";
    }
  }
  if (entity === "participants" && creating) {
    if (!PARTICIPANT_TYPES.includes(row.participant_type as never)) {
      return "participant_type is required (expert|attorney|contact).";
    }
    if (!isUuid(row.case_id)) return "case_id is required for participants.";
    if (!isUuid(row.contact_id) && !isUuid(row.account_id)) {
      return "Provide contact_id or account_id for participants.";
    }
  }
  if (entity === "depositions" && creating) {
    if (!isUuid(row.case_id)) return "case_id is required for depositions.";
    if (!hasText(row.deponent, row.description, row.display_text)) {
      return "Provide a deponent or deposition description.";
    }
  }
  if (entity === "time_entries") {
    for (const field of ["hours", "hourly_rate", "multiplier", "billed_amount"] as const) {
      const value = row[field];
      if (value != null && (typeof value !== "number" || value < 0)) {
        return `${field} must be a non-negative number.`;
      }
    }
    if (creating && !isUuid(row.case_id)) return "case_id is required for time entries.";
    if (creating && !isUuid(row.staff_id)) return "staff_id is required for time entries.";
    if (creating && !hasText(row.entry_date)) return "entry_date is required for time entries.";
    if (creating && typeof row.hours !== "number") {
      return "hours is required for time entries.";
    }
  }
  return null;
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
      error: "Forensic case data is not configured. Contact your administrator.",
    },
    { status: 503 },
  );
}

function badRequest(error: string): Response {
  return json({ ok: false, error }, { status: 400 });
}

function notFound(error = "Not found."): Response {
  return json({ ok: false, error }, { status: 404 });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  }
  const formData = await request.formData().catch(() => undefined);
  return formData ? Object.fromEntries(formData.entries()) : {};
}

function readEntity(value: unknown): ForensicEntity | null {
  return typeof value === "string" && VALID_ENTITIES.has(value)
    ? (value as ForensicEntity)
    : null;
}

function parseListOptions(url: URL): ForensicListOptions | string {
  const uuidParams = ["caseId", "contactId", "accountId", "staffId"] as const;
  for (const name of uuidParams) {
    const value = url.searchParams.get(name);
    if (value !== null && !isUuid(value)) return `${name} must be a valid UUID.`;
  }

  const kind = url.searchParams.get("kind");
  if (kind !== null && !CONTACT_METHOD_KINDS.includes(kind as never)) {
    return "kind must be phone or email.";
  }
  const participantType = url.searchParams.get("participantType");
  if (participantType !== null && !PARTICIPANT_TYPES.includes(participantType as never)) {
    return "participantType must be expert, attorney, or contact.";
  }

  return {
    limit: parseListLimit(url.searchParams.get("limit")),
    cursor: capString(url.searchParams.get("cursor"), 1000) ?? undefined,
    search: capString(url.searchParams.get("search"), MAX_NAME) ?? undefined,
    caseId: url.searchParams.get("caseId"),
    contactId: url.searchParams.get("contactId"),
    accountId: url.searchParams.get("accountId"),
    staffId: url.searchParams.get("staffId"),
    kind: kind as "phone" | "email" | null,
    participantType: participantType as
      | "expert"
      | "attorney"
      | "contact"
      | null,
  };
}

export function createForensicCaseRouteHandlers(
  options: ForensicCaseRouteOptions = {},
) {
  const authorized = (request: Request, method: ForensicMethod) =>
    options.authorize
      ? Promise.resolve(options.authorize(request, method))
      : Promise.resolve(false);

  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isForensicCaseConfigured()) return setupRequired();

    const url = new URL(request.url);
    const entity = readEntity(url.searchParams.get("entity"));
    if (!entity) {
      return badRequest(`A valid ?entity= is required (${VALID_ENTITY_LABEL}).`);
    }

    const id = url.searchParams.get("id");
    if (id !== null) {
      if (!isUuid(id)) return badRequest("id must be a valid UUID.");
      const record = await getForensicRecord(entity, id);
      return record
        ? json({ ok: true, entity, record })
        : notFound("Forensic case record not found.");
    }

    const listOptions = parseListOptions(url);
    if (typeof listOptions === "string") return badRequest(listOptions);
    const page = await listForensicRecords(entity, listOptions);
    return json({ ok: true, entity, records: page.rows, nextCursor: page.nextCursor });
  }

  async function POST(request: Request): Promise<Response> {
    if (!(await authorized(request, "POST"))) return unauthorized();
    if (!isForensicCaseConfigured()) return setupRequired();

    const body = await readBody(request);
    const entity = readEntity(body.entity);
    if (!entity) return badRequest("A valid entity field is required.");
    const input = pickForensicInput(entity, body);
    const validationError = validateForensicInput(entity, input, true);
    if (validationError) return badRequest(validationError);

    const record = await createForensicRecord(entity, input);
    return record
      ? json({ ok: true, id: record.id, entity, record }, { status: 201 })
      : json({ ok: false, error: "Could not create forensic case record." }, { status: 500 });
  }

  async function PATCH(request: Request): Promise<Response> {
    if (!(await authorized(request, "PATCH"))) return unauthorized();
    if (!isForensicCaseConfigured()) return setupRequired();

    const body = await readBody(request);
    const entity = readEntity(body.entity);
    if (!entity) return badRequest("A valid entity field is required.");
    if (!isUuid(body.id)) return badRequest("id must be a valid UUID.");
    const input = pickForensicInput(entity, body);
    const validationError = validateForensicInput(entity, input, false);
    if (validationError) return badRequest(validationError);

    const record = await patchForensicRecord(entity, body.id, input);
    return record
      ? json({ ok: true, id: record.id, entity, record })
      : notFound("Forensic case record not found.");
  }

  async function DELETE(request: Request): Promise<Response> {
    if (!(await authorized(request, "DELETE"))) return unauthorized();
    if (!isForensicCaseConfigured()) return setupRequired();

    const url = new URL(request.url);
    const entity = readEntity(url.searchParams.get("entity"));
    if (!entity) {
      return badRequest(`A valid ?entity= is required (${VALID_ENTITY_LABEL}).`);
    }
    const id = url.searchParams.get("id");
    if (!id || !isUuid(id)) return badRequest("id must be a valid UUID.");

    const record = await softDeleteForensicRecord(entity, id);
    return record
      ? json({ ok: true, id: record.id, entity, record })
      : notFound("Forensic case record not found.");
  }

  return { GET, POST, PATCH, DELETE };
}
