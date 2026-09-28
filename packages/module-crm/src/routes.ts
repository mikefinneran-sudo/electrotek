// Route-handler factory for /api/crm-records. A single endpoint discriminated
// by a ?entity= query param (GET/DELETE) or an `entity` body field (POST/PATCH).
// Entities: accounts | contacts | opportunities | activities | tasks | stages
// | pipelines | deal_contacts.

import "server-only";
import {
  addDealContact,
  createAccount,
  createCase,
  createActivity,
  createContact,
  createOpportunity,
  createPipeline,
  createStage,
  createTask,
  findDuplicateAccount,
  findDuplicateContact,
  getAccount,
  getCase,
  getContact,
  getOpportunity,
  isCrmConfigured,
  listAccounts,
  listCases,
  listActivities,
  listActiveStages,
  listAllTasks,
  listContacts,
  listDealContacts,
  listOpportunities,
  listPipelines,
  listTasks,
  patchAccount,
  patchCase,
  patchContact,
  patchOpportunity,
  patchPipeline,
  patchStage,
  patchTask,
  removeDealContact,
  reorderStages,
  softDeleteAccount,
  softDeleteCase,
  softDeleteContact,
  softDeleteOpportunity,
  MAX_LIST_LIMIT,
  MAX_NAME,
  MAX_TEXT,
  type AccountInput,
  type CaseInput,
  type ActivityInput,
  type ContactInput,
  type CrmTaskInput,
  type DealContactInput,
  type KeysetListOptions,
  type OpportunityInput,
  type PipelineInput,
  type StageInput,
} from "./server";
import {
  ACTIVITY_TYPES,
  CASE_STATUSES,
  OPPORTUNITY_STATUSES,
  type CaseStatus,
  type CustomFields,
} from "./types";

type CrmMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface CrmRouteOptions {
  /**
   * Called before every handler. Return true to allow the request. When absent,
   * all requests are rejected with 401 — there is no safe default for a
   * staff-only resource backed by the RLS-bypassing service-role client.
   */
  authorize?: (request: Request, method: CrmMethod) => boolean | Promise<boolean>;
}

const VALID_ENTITIES = new Set([
  "accounts",
  "cases",
  "contacts",
  "opportunities",
  "activities",
  "tasks",
  "stages",
  "pipelines",
  "deal_contacts",
]);

const VALID_ENTITY_LABEL =
  "accounts|cases|contacts|opportunities|activities|tasks|stages|pipelines|deal_contacts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
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
      error: "CRM is not configured. Contact your administrator.",
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
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  }
  const formData = await request.formData().catch(() => undefined);
  if (!formData) return {};
  return Object.fromEntries(formData.entries());
}

function capString(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  const s = String(value).slice(0, max);
  return s.length > 0 ? s : null;
}

function numericOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  const n = numericOrNull(value);
  if (n == null || n < 0) return null;
  return Math.floor(n);
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  const n = numericOrNull(value);
  return n == null ? undefined : n;
}

function probabilityOrUndefined(value: unknown): number | undefined {
  const n = numericOrNull(value);
  return n != null && n >= 0 && n <= 1 ? n : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

// `date` columns (close_date, due_date) accept only YYYY-MM-DD. Coerce anything
// else to null so a malformed value is dropped rather than surfacing as a
// swallowed Postgres 500 — consistent with invalid uuid coercion below.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE_RE.test(value) ? value : null;
}

// Mirrors the email shape enforced by module-lead-capture's submit_lead RPC
// (0002_lead_rpc.sql) so contact email format is consistent across modules.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

function jsonObjectOrUndefined(value: unknown): CustomFields | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return jsonObjectOrUndefined(parsed);
    } catch {
      return undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as CustomFields)
    : undefined;
}

function jsonArrayOrUndefined(value: unknown): unknown[] | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return jsonArrayOrUndefined(parsed);
    } catch {
      return undefined;
    }
  }
  return Array.isArray(value) ? value : undefined;
}

function parseLimit(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(n)));
}

function parseListOptions(url: URL): KeysetListOptions {
  return {
    limit: parseLimit(url.searchParams.get("limit")),
    cursor: capString(url.searchParams.get("cursor"), 1000) ?? undefined,
    search: capString(url.searchParams.get("search"), MAX_NAME) ?? undefined,
  };
}

function parseDue(value: string | null): "overdue" | "today" | "upcoming" | "all" {
  return value === "overdue" || value === "today" || value === "upcoming" || value === "all"
    ? value
    : "all";
}

function parseToday(value: string | null): string | undefined {
  return value !== null && ISO_DATE_RE.test(value) ? value : undefined;
}

// --- input pickers ----------------------------------------------------------

function pickAccountInput(body: Record<string, unknown>): AccountInput {
  return {
    name: "name" in body ? capString(body.name, MAX_NAME) : undefined,
    domain: "domain" in body ? capString(body.domain, MAX_NAME) : undefined,
    industry: "industry" in body ? capString(body.industry, MAX_NAME) : undefined,
    notes: "notes" in body ? capString(body.notes, MAX_TEXT) : undefined,
    custom_fields: jsonObjectOrUndefined(body.custom_fields),
  };
}

function pickDate(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const raw = body[key];
  if (raw === null || raw === "") return null;
  return typeof raw === "string" && ISO_DATE_RE.test(raw) ? raw : undefined;
}

function pickCaseInput(body: Record<string, unknown>): CaseInput {
  const status =
    "status" in body && (CASE_STATUSES as readonly string[]).includes(String(body.status))
      ? (String(body.status) as CaseStatus)
      : undefined;

  return {
    case_number: "case_number" in body ? capString(body.case_number, MAX_NAME) : undefined,
    account_id:
      "account_id" in body ? (isUuid(body.account_id) ? body.account_id : null) : undefined,
    contact_id:
      "contact_id" in body ? (isUuid(body.contact_id) ? body.contact_id : null) : undefined,
    title: "title" in body ? capString(body.title, MAX_NAME) : undefined,
    status,
    case_type: "case_type" in body ? capString(body.case_type, MAX_NAME) : undefined,
    incident_date: pickDate(body, "incident_date"),
    incident_location:
      "incident_location" in body ? capString(body.incident_location, MAX_NAME) : undefined,
    opened_on: pickDate(body, "opened_on"),
    closed_on: pickDate(body, "closed_on"),
    notes: "notes" in body ? capString(body.notes, MAX_TEXT) : undefined,
    custom_fields: jsonObjectOrUndefined(body.custom_fields),
  };
}

function pickContactInput(body: Record<string, unknown>): ContactInput {
  const account_id =
    "account_id" in body
      ? isUuid(body.account_id)
        ? body.account_id
        : null
      : undefined;
  const lead_id =
    "lead_id" in body ? (isUuid(body.lead_id) ? body.lead_id : null) : undefined;
  return {
    ...(account_id !== undefined ? { account_id } : {}),
    ...(lead_id !== undefined ? { lead_id } : {}),
    first_name: "first_name" in body ? capString(body.first_name, MAX_NAME) : undefined,
    last_name: "last_name" in body ? capString(body.last_name, MAX_NAME) : undefined,
    email: "email" in body ? capString(body.email, MAX_NAME) : undefined,
    phone: "phone" in body ? capString(body.phone, MAX_NAME) : undefined,
    title: "title" in body ? capString(body.title, MAX_NAME) : undefined,
    custom_fields: jsonObjectOrUndefined(body.custom_fields),
  };
}

function pickPipelineInput(body: Record<string, unknown>): PipelineInput {
  const is_active = booleanOrUndefined(body.is_active);
  return {
    name: capString(body.name, MAX_NAME) ?? undefined,
    ...(is_active !== undefined ? { is_active } : {}),
    order_index: "order_index" in body ? finiteNumberOrUndefined(body.order_index) : undefined,
  };
}

function pickStageInput(body: Record<string, unknown>): StageInput {
  const pipeline_id =
    "pipeline_id" in body
      ? isUuid(body.pipeline_id)
        ? body.pipeline_id
        : null
      : undefined;
  const active = booleanOrUndefined(body.active);
  return {
    ...(pipeline_id !== undefined ? { pipeline_id } : {}),
    name: capString(body.name, MAX_NAME) ?? undefined,
    sort_order: "sort_order" in body ? finiteNumberOrUndefined(body.sort_order) : undefined,
    ...(active !== undefined ? { active } : {}),
    probability_weight:
      "probability_weight" in body ? probabilityOrUndefined(body.probability_weight) : undefined,
    rotten_days: "rotten_days" in body ? nonNegativeIntegerOrNull(body.rotten_days) : undefined,
    required_fields:
      "required_fields" in body ? jsonArrayOrUndefined(body.required_fields) : undefined,
  };
}

function pickOpportunityInput(body: Record<string, unknown>): OpportunityInput {
  const account_id =
    "account_id" in body
      ? isUuid(body.account_id)
        ? body.account_id
        : null
      : undefined;
  const contact_id =
    "contact_id" in body
      ? isUuid(body.contact_id)
        ? body.contact_id
        : null
      : undefined;
  const stage_id =
    "stage_id" in body ? (isUuid(body.stage_id) ? body.stage_id : null) : undefined;
  const rawStatus = body.status;
  const status = OPPORTUNITY_STATUSES.includes(rawStatus as never)
    ? (rawStatus as "open" | "won" | "lost")
    : undefined;
  return {
    ...(account_id !== undefined ? { account_id } : {}),
    ...(contact_id !== undefined ? { contact_id } : {}),
    ...(stage_id !== undefined ? { stage_id } : {}),
    name: capString(body.name, MAX_NAME) ?? undefined,
    amount: "amount" in body ? numericOrNull(body.amount) : undefined,
    close_date: "close_date" in body ? isoDateOrNull(body.close_date) : undefined,
    ...(status !== undefined ? { status } : {}),
    lost_reason: "lost_reason" in body ? capString(body.lost_reason, MAX_TEXT) : undefined,
    custom_fields: jsonObjectOrUndefined(body.custom_fields),
  };
}

function pickActivityInput(body: Record<string, unknown>): ActivityInput | null {
  const rawType = body.type;
  if (!ACTIVITY_TYPES.includes(rawType as never)) return null;
  const type = rawType as "call" | "email" | "meeting" | "note";
  const opportunity_id = isUuid(body.opportunity_id) ? body.opportunity_id : undefined;
  const contact_id = isUuid(body.contact_id) ? body.contact_id : undefined;
  const account_id = isUuid(body.account_id) ? body.account_id : undefined;
  return {
    type,
    ...(opportunity_id !== undefined ? { opportunity_id } : {}),
    ...(contact_id !== undefined ? { contact_id } : {}),
    ...(account_id !== undefined ? { account_id } : {}),
    body: capString(body.body, MAX_TEXT) ?? undefined,
    occurred_at: capString(body.occurred_at, 64) ?? undefined,
  };
}

function pickTaskInput(body: Record<string, unknown>): CrmTaskInput {
  const opportunity_id =
    "opportunity_id" in body
      ? isUuid(body.opportunity_id)
        ? body.opportunity_id
        : null
      : undefined;
  const contact_id =
    "contact_id" in body
      ? isUuid(body.contact_id)
        ? body.contact_id
        : null
      : undefined;
  const done = booleanOrUndefined(body.done);
  return {
    ...(opportunity_id !== undefined ? { opportunity_id } : {}),
    ...(contact_id !== undefined ? { contact_id } : {}),
    title: capString(body.title, MAX_NAME) ?? undefined,
    due_date: "due_date" in body ? isoDateOrNull(body.due_date) : undefined,
    ...(done !== undefined ? { done } : {}),
  };
}

function pickDealContactInput(body: Record<string, unknown>): DealContactInput | null {
  const deal_id = isUuid(body.deal_id)
    ? body.deal_id
    : isUuid(body.dealId)
      ? body.dealId
      : null;
  const contact_id = isUuid(body.contact_id)
    ? body.contact_id
    : isUuid(body.contactId)
      ? body.contactId
      : null;
  if (!deal_id || !contact_id) return null;
  const is_primary = booleanOrUndefined(body.is_primary);
  return {
    deal_id,
    contact_id,
    role: capString(body.role, MAX_NAME) ?? undefined,
    ...(is_primary !== undefined ? { is_primary } : {}),
  };
}

function readOrderedIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return null;
  const ids = value.map((item) => (typeof item === "string" ? item : ""));
  return ids.every(isUuid) ? ids : null;
}

export function createCrmRouteHandlers(options: CrmRouteOptions) {
  // Deny-by-default: no authorize ⇒ every request is rejected.
  const authorized = (request: Request, method: CrmMethod) =>
    options.authorize
      ? Promise.resolve(options.authorize(request, method))
      : Promise.resolve(false);

  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isCrmConfigured()) return setupRequired();

    const url = new URL(request.url);
    const entity = url.searchParams.get("entity") ?? "";
    if (!VALID_ENTITIES.has(entity)) {
      return badRequest(`A valid ?entity= is required (${VALID_ENTITY_LABEL}).`);
    }

    const id = url.searchParams.get("id");

    // Single-item fetch
    if (id !== null) {
      if (!isUuid(id)) return badRequest("id must be a valid UUID.");

      if (entity === "accounts") {
        const row = await getAccount(id);
        return row ? json({ ok: true, account: row }) : notFound("Account not found.");
      }
      if (entity === "cases") {
        const row = await getCase(id);
        return row ? json({ ok: true, case: row }) : notFound("Case not found.");
      }
      if (entity === "contacts") {
        const row = await getContact(id);
        return row ? json({ ok: true, contact: row }) : notFound("Contact not found.");
      }
      if (entity === "opportunities") {
        const row = await getOpportunity(id);
        return row ? json({ ok: true, opportunity: row }) : notFound("Opportunity not found.");
      }
      return badRequest("Single-item fetch by id is not supported for this entity.");
    }

    // List
    if (entity === "accounts") {
      const page = await listAccounts(parseListOptions(url));
      return json({ ok: true, accounts: page.rows, nextCursor: page.nextCursor });
    }
    if (entity === "cases") {
      const page = await listCases(parseListOptions(url));
      return json({ ok: true, cases: page.rows, nextCursor: page.nextCursor });
    }
    if (entity === "pipelines") {
      const rows = await listPipelines();
      return json({ ok: true, pipelines: rows });
    }
    if (entity === "stages") {
      const pipelineId = url.searchParams.get("pipelineId");
      if (pipelineId !== null && !isUuid(pipelineId)) {
        return badRequest("pipelineId must be a valid UUID.");
      }
      const rows = await listActiveStages(pipelineId ? { pipelineId } : undefined);
      return json({ ok: true, stages: rows });
    }
    if (entity === "contacts") {
      const accountId = url.searchParams.get("accountId");
      if (accountId !== null && !isUuid(accountId)) {
        return badRequest("accountId must be a valid UUID.");
      }
      const page = await listContacts({
        ...(accountId ? { accountId } : {}),
        ...parseListOptions(url),
      });
      return json({ ok: true, contacts: page.rows, nextCursor: page.nextCursor });
    }
    if (entity === "opportunities") {
      const stageId = url.searchParams.get("stageId");
      const accountId = url.searchParams.get("accountId");
      if (stageId !== null && !isUuid(stageId)) return badRequest("stageId must be a valid UUID.");
      if (accountId !== null && !isUuid(accountId)) return badRequest("accountId must be a valid UUID.");
      const page = await listOpportunities({
        ...(stageId ? { stageId } : {}),
        ...(accountId ? { accountId } : {}),
        ...parseListOptions(url),
      });
      return json({ ok: true, opportunities: page.rows, nextCursor: page.nextCursor });
    }
    if (entity === "deal_contacts") {
      const dealId = url.searchParams.get("dealId");
      if (!dealId || !isUuid(dealId)) return badRequest("dealId must be a valid UUID.");
      const rows = await listDealContacts(dealId);
      return json({ ok: true, deal_contacts: rows });
    }
    if (entity === "activities") {
      const opportunityId = url.searchParams.get("opportunityId");
      const contactId = url.searchParams.get("contactId");
      if (opportunityId !== null && !isUuid(opportunityId)) {
        return badRequest("opportunityId must be a valid UUID.");
      }
      if (contactId !== null && !isUuid(contactId)) {
        return badRequest("contactId must be a valid UUID.");
      }
      if (!opportunityId && !contactId) {
        return badRequest("Provide opportunityId or contactId to list activities.");
      }
      const rows = await listActivities({
        ...(opportunityId ? { opportunityId } : {}),
        ...(contactId ? { contactId } : {}),
      });
      return json({ ok: true, activities: rows });
    }
    if (entity === "tasks") {
      const opportunityId = url.searchParams.get("opportunityId");
      const contactId = url.searchParams.get("contactId");
      if (opportunityId !== null && !isUuid(opportunityId)) {
        return badRequest("opportunityId must be a valid UUID.");
      }
      if (contactId !== null && !isUuid(contactId)) {
        return badRequest("contactId must be a valid UUID.");
      }
      if (opportunityId || contactId) {
        const rows = await listTasks({
          ...(opportunityId ? { opportunityId } : {}),
          ...(contactId ? { contactId } : {}),
        });
        return json({ ok: true, tasks: rows });
      }
      const page = await listAllTasks({
        due: parseDue(url.searchParams.get("due")),
        limit: parseLimit(url.searchParams.get("limit")),
        cursor: capString(url.searchParams.get("cursor"), 1000),
        today: parseToday(url.searchParams.get("today")),
      });
      return json({ ok: true, tasks: page.rows, nextCursor: page.nextCursor });
    }

    return badRequest("Unsupported entity.");
  }

  async function POST(request: Request): Promise<Response> {
    if (!(await authorized(request, "POST"))) return unauthorized();
    if (!isCrmConfigured()) return setupRequired();

    const body = await readBody(request);
    const entity = typeof body.entity === "string" ? body.entity : "";
    if (!VALID_ENTITIES.has(entity)) {
      return badRequest("A valid entity field is required.");
    }

    if (entity === "accounts") {
      const input = pickAccountInput(body);
      if (!input.name) return badRequest("name is required for accounts.");
      const duplicate = await findDuplicateAccount(input.name, input.domain);
      if (duplicate) {
        return json({ ok: true, id: duplicate.id, account: duplicate, duplicate: true });
      }
      const row = await createAccount(input);
      return row
        ? json({ ok: true, id: row.id, account: row }, { status: 201 })
        : json({ ok: false, error: "Could not create account." }, { status: 500 });
    }

    if (entity === "cases") {
      const input = pickCaseInput(body);
      if (!input.case_number) return badRequest("case_number is required for cases.");
      if (!input.title) return badRequest("title is required for cases.");
      const row = await createCase(input);
      return row
        ? json({ ok: true, id: row.id, case: row }, { status: 201 })
        : json(
            {
              ok: false,
              // The most likely cause by far is the unique constraint on
              // case_number, so say so rather than a bare 500.
              error: "Could not create case. The case number may already be in use.",
            },
            { status: 500 },
          );
    }

    if (entity === "contacts") {
      const input = pickContactInput(body);
      if (!input.first_name && !input.last_name && !input.email) {
        return badRequest("Provide at least one of first_name, last_name, or email.");
      }
      if (input.email && !isValidEmail(input.email)) {
        return badRequest("email must be a valid email address.");
      }
      const duplicate = await findDuplicateContact(input.email);
      if (duplicate) {
        return json({ ok: true, id: duplicate.id, contact: duplicate, duplicate: true });
      }
      const row = await createContact(input);
      return row
        ? json({ ok: true, id: row.id, contact: row }, { status: 201 })
        : json({ ok: false, error: "Could not create contact." }, { status: 500 });
    }

    if (entity === "pipelines") {
      const input = pickPipelineInput(body);
      if (!input.name) return badRequest("name is required for pipelines.");
      const row = await createPipeline(input);
      return row
        ? json({ ok: true, id: row.id, pipeline: row }, { status: 201 })
        : json({ ok: false, error: "Could not create pipeline." }, { status: 500 });
    }

    if (entity === "stages") {
      const input = pickStageInput(body);
      if (!input.name) return badRequest("name is required for stages.");
      if (!input.pipeline_id) return badRequest("pipeline_id is required for stages.");
      const row = await createStage(input);
      return row
        ? json({ ok: true, id: row.id, stage: row }, { status: 201 })
        : json({ ok: false, error: "Could not create stage." }, { status: 500 });
    }

    if (entity === "opportunities") {
      const input = pickOpportunityInput(body);
      if (!input.name) return badRequest("name is required for opportunities.");
      const row = await createOpportunity(input);
      return row
        ? json({ ok: true, id: row.id, opportunity: row }, { status: 201 })
        : json({ ok: false, error: "Could not create opportunity." }, { status: 500 });
    }

    if (entity === "deal_contacts") {
      const input = pickDealContactInput(body);
      if (!input) return badRequest("deal_id and contact_id must be valid UUIDs.");
      const row = await addDealContact(input);
      return row
        ? json({ ok: true, id: `${row.deal_id}:${row.contact_id}`, deal_contact: row }, { status: 201 })
        : json({ ok: false, error: "Could not add deal contact." }, { status: 500 });
    }

    if (entity === "activities") {
      const input = pickActivityInput(body);
      if (!input) return badRequest("A valid activity type is required (call|email|meeting|note).");
      const row = await createActivity(input);
      return row
        ? json({ ok: true, id: row.id, activity: row }, { status: 201 })
        : json({ ok: false, error: "Could not create activity." }, { status: 500 });
    }

    if (entity === "tasks") {
      const input = pickTaskInput(body);
      if (!input.title) return badRequest("title is required for tasks.");
      const row = await createTask(input);
      return row
        ? json({ ok: true, id: row.id, task: row }, { status: 201 })
        : json({ ok: false, error: "Could not create task." }, { status: 500 });
    }

    return badRequest("Unsupported entity.");
  }

  async function PATCH(request: Request): Promise<Response> {
    if (!(await authorized(request, "PATCH"))) return unauthorized();
    if (!isCrmConfigured()) return setupRequired();

    const body = await readBody(request);
    const entity = typeof body.entity === "string" ? body.entity : "";
    if (!VALID_ENTITIES.has(entity)) {
      return badRequest("A valid entity field is required.");
    }

    if (entity === "stages" && "orderedIds" in body) {
      const orderedIds = readOrderedIds(body.orderedIds);
      if (!orderedIds) return badRequest("orderedIds must be a non-empty array of UUIDs.");
      const rows = await reorderStages(orderedIds);
      return rows
        ? json({ ok: true, stages: rows })
        : badRequest("Could not reorder stages. IDs must exist in a single pipeline.");
    }

    const rawId = body.id;
    if (!isUuid(rawId)) return badRequest("id must be a valid UUID.");
    const id = rawId;

    if (entity === "accounts") {
      const input = pickAccountInput(body);
      const row = await patchAccount(id, input);
      return row
        ? json({ ok: true, id: row.id, account: row })
        : notFound("Account not found.");
    }

    if (entity === "cases") {
      const input = pickCaseInput(body);
      const row = await patchCase(id, input);
      return row ? json({ ok: true, id: row.id, case: row }) : notFound("Case not found.");
    }

    if (entity === "contacts") {
      const input = pickContactInput(body);
      if (input.email && !isValidEmail(input.email)) {
        return badRequest("email must be a valid email address.");
      }
      const row = await patchContact(id, input);
      return row
        ? json({ ok: true, id: row.id, contact: row })
        : notFound("Contact not found.");
    }

    if (entity === "pipelines") {
      const input = pickPipelineInput(body);
      const row = await patchPipeline(id, input);
      return row
        ? json({ ok: true, id: row.id, pipeline: row })
        : notFound("Pipeline not found.");
    }

    if (entity === "stages") {
      const input = pickStageInput(body);
      const row = await patchStage(id, input);
      return row ? json({ ok: true, id: row.id, stage: row }) : notFound("Stage not found.");
    }

    if (entity === "opportunities") {
      const input = pickOpportunityInput(body);
      const row = await patchOpportunity(id, input);
      return row
        ? json({ ok: true, id: row.id, opportunity: row })
        : notFound("Opportunity not found.");
    }

    if (entity === "tasks") {
      const input = pickTaskInput(body);
      const row = await patchTask(id, input);
      return row
        ? json({ ok: true, id: row.id, task: row })
        : notFound("Task not found.");
    }

    return badRequest("PATCH is not supported for this entity.");
  }

  async function DELETE(request: Request): Promise<Response> {
    if (!(await authorized(request, "DELETE"))) return unauthorized();
    if (!isCrmConfigured()) return setupRequired();

    const url = new URL(request.url);
    const entity = url.searchParams.get("entity") ?? "";
    if (!VALID_ENTITIES.has(entity)) {
      return badRequest(`A valid ?entity= is required (${VALID_ENTITY_LABEL}).`);
    }

    if (
      entity === "accounts" ||
      entity === "cases" ||
      entity === "contacts" ||
      entity === "opportunities"
    ) {
      const id = url.searchParams.get("id");
      if (!id || !isUuid(id)) return badRequest("id must be a valid UUID.");

      if (entity === "cases") {
        const row = await softDeleteCase(id);
        return row ? json({ ok: true, id: row.id, case: row }) : notFound("Case not found.");
      }
      if (entity === "accounts") {
        const row = await softDeleteAccount(id);
        return row ? json({ ok: true, id: row.id, account: row }) : notFound("Account not found.");
      }
      if (entity === "contacts") {
        const row = await softDeleteContact(id);
        return row ? json({ ok: true, id: row.id, contact: row }) : notFound("Contact not found.");
      }
      const row = await softDeleteOpportunity(id);
      return row
        ? json({ ok: true, id: row.id, opportunity: row })
        : notFound("Opportunity not found.");
    }

    if (entity === "deal_contacts") {
      const dealId = url.searchParams.get("dealId");
      const contactId = url.searchParams.get("contactId");
      if (!dealId || !isUuid(dealId)) return badRequest("dealId must be a valid UUID.");
      if (!contactId || !isUuid(contactId)) return badRequest("contactId must be a valid UUID.");
      const row = await removeDealContact(dealId, contactId);
      return row
        ? json({ ok: true, id: `${row.deal_id}:${row.contact_id}`, deal_contact: row })
        : notFound("Deal contact not found.");
    }

    return badRequest("DELETE is not supported for this entity.");
  }

  return { GET, POST, PATCH, DELETE };
}
