// Route-handler factory for /api/inspection. Mirrors lead-capture's
// createContactPostHandler factory style. The consuming app re-exports the
// returned GET/POST/PATCH from app/api/inspection/route.ts.
//
//   POST   create a drafting inspection from the wizard (+ optional add-ons)
//   PATCH  update pricing/scope/status on an existing inspection
//   GET    fetch an inspection as JSON, or stream its quote PDF with ?pdf=1

import type { QuoteLabels } from "./labels";
import { toPublicQuoteView } from "./lifecycle";
import type { ManualLineInput } from "./line-items";
import { generateQuotePdf, quotePdfFilename, type QuoteProvider } from "./pdf";
import {
  createInspection,
  deleteLineItem,
  getAddons,
  getInspection,
  getInspectionByToken,
  isQuoteEngineConfigured,
  listLineItems,
  patchInspection,
  recordQuoteViewed,
  regenerateQuoteLines,
  respondToQuote,
  upsertAddons,
  upsertLineItems,
  type AddonInput,
  type InspectionInput,
} from "./server";
import type { Inspection, QuoteAddon } from "./types";

// Re-exported so a consuming app can type its provider block without reaching
// into ./pdf, which is not in the package's exports map.
export type { QuoteProvider } from "./pdf";
export type { QuoteLabels } from "./labels";

export interface InspectionRouteOptions {
  /** Provider/brand details stamped onto generated quote PDFs. */
  provider: QuoteProvider;
  /**
   * Per-client wording on the quote document. Omit for the default janitorial
   * phrasing; supply overrides for any other vertical. See ./labels.ts.
   */
  labels?: Partial<QuoteLabels> | null;
  /**
   * Called before EVERY handler. Return true to allow the request. When absent,
   * all requests are rejected with 401 — there is no safe default for a
   * staff-only resource backed by the RLS-bypassing service-role client. The
   * consuming app wires in whatever auth it has (a shared-secret header now, a
   * staff session once the admin/crew module ships).
   */
  authorize?: (
    request: Request,
    method: "GET" | "POST" | "PATCH",
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
      error: "Quote engine is not configured. Contact your administrator.",
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

function normalizeAddonInputs(raw: unknown): AddonInput[] {
  if (!Array.isArray(raw)) return [];
  const result: AddonInput[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const addonId = r.addon_id ?? r.id;
    const name = r.name;
    if (!addonId || !name) continue;
    result.push({
      addon_id: String(addonId),
      name: String(name),
      price: r.price != null && r.price !== "" ? Number(r.price) : null,
      enabled: r.enabled !== false,
    });
  }
  return result;
}

/**
 * Normalize the operator's line rows from a request body.
 *
 * Only manual-line fields are read. `origin`, `origin_key` and `line_total` are
 * NOT accepted from a client at any price: the first two would let a caller put
 * its row inside the regeneration's blast radius (or squat an origin_key the
 * generator needs), and the third is a generated column. A row with no
 * description is dropped rather than saved blank — a nameless charge on a
 * customer-facing quote is not something to ship.
 *
 * Returns `null` when the body does not mention line items at all, which is
 * different from `[]`: the empty array means "the operator deleted every manual
 * row", and null means "this request is not about line items". Conflating them
 * would make any PATCH silently wipe the manual lines.
 */
function normalizeLineInputs(raw: unknown): ManualLineInput[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;

  const result: ManualLineInput[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const description = typeof r.description === "string" ? r.description.trim() : "";
    if (!description) continue;

    const num = (value: unknown, fallback: number): number => {
      if (value == null || value === "") return fallback;
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    result.push({
      id: typeof r.id === "string" && r.id ? r.id : undefined,
      product_id: r.product_id != null && r.product_id !== "" ? num(r.product_id, 0) : null,
      sku: typeof r.sku === "string" && r.sku.trim() ? r.sku.trim() : null,
      description,
      quantity: num(r.quantity, 1),
      unit_price: num(r.unit_price, 0),
      tax_rate: num(r.tax_rate, 0),
      // sort_order is deliberately not read: the array's order IS the document
      // order, and honouring a client-supplied value only invites two rows to
      // claim the same position.
    });
  }
  return result;
}

// Only inspection columns are forwarded to the DB layer; `addons` and any
// unknown keys are stripped here so a wizard payload can't write arbitrary
// fields. server.ts also picks writable fields as a second guard.
const INSPECTION_KEYS: readonly (keyof InspectionInput)[] = [
  "prospect_name",
  "prospect_company",
  "prospect_email",
  "prospect_phone",
  "office_address",
  "walkthrough_date",
  "cleanable_sqft",
  "visits_per_week",
  "scope_inclusions",
  "scope_exclusions",
  "cleaning_days",
  "clean_window",
  "target_start",
  "consumables_provided_by",
  "current_cleaner",
  "current_cleaner_issues",
  "decision_process",
  "internal_notes",
  "number_of_offices",
  "number_of_board_rooms",
  "dumpster_access",
  "parking_access",
  "water_access",
  "status",
  "valid_until",
  "quote_rate_per_sqft",
  "quote_base_monthly",
];

const NUMERIC_KEYS = new Set<keyof InspectionInput>([
  "cleanable_sqft",
  "visits_per_week",
  "number_of_offices",
  "number_of_board_rooms",
  "quote_rate_per_sqft",
  "quote_base_monthly",
]);

function pickInspectionInput(body: Record<string, unknown>): InspectionInput {
  const input: InspectionInput = {};
  for (const key of INSPECTION_KEYS) {
    if (!(key in body)) continue;
    const value = body[key];
    if (NUMERIC_KEYS.has(key)) {
      const n = value == null || value === "" ? null : Number(value);
      (input as Record<string, unknown>)[key] = n != null && Number.isFinite(n) ? n : null;
    } else {
      (input as Record<string, unknown>)[key] = value === "" ? null : value;
    }
  }
  return input;
}

export function createInspectionRouteHandlers(options: InspectionRouteOptions) {
  // Deny-by-default: with no authorize callback wired by the app, every request
  // is rejected. inspections are staff-only and served via the service-role
  // client (RLS is bypassed), so the route layer is the only gate.
  const authorized = (request: Request, method: "GET" | "POST" | "PATCH") =>
    options.authorize ? Promise.resolve(options.authorize(request, method)) : Promise.resolve(false);

  async function POST(request: Request): Promise<Response> {
    if (!(await authorized(request, "POST"))) return unauthorized();
    if (!isQuoteEngineConfigured()) return setupRequired();

    const body = await readBody(request);
    const input = pickInspectionInput(body);
    if (!input.prospect_name && !input.prospect_company) {
      return json({ ok: false, error: "A contact name or company is required." }, { status: 400 });
    }
    input.status = input.status ?? "drafting";

    const inspection = await createInspection(input);
    if (!inspection) {
      return json({ ok: false, error: "Could not create the inspection." }, { status: 500 });
    }

    const addons = normalizeAddonInputs(body.addons);
    if (addons.length) await upsertAddons(inspection.id, addons);

    const manualLines = normalizeLineInputs(body.line_items);
    if (manualLines) await upsertLineItems(inspection.id, manualLines);

    // Generated lines come LAST, after the add-ons they are derived from exist.
    // Re-read the inspection too: the trigger has since written subtotal/tax/
    // total, and the copy created above still says 0.
    const lines = await regenerateQuoteLines(inspection.id);
    const priced = (await getInspection(inspection.id)) ?? inspection;

    return json({ ok: true, id: priced.id, inspection: priced, lines }, { status: 201 });
  }

  async function PATCH(request: Request): Promise<Response> {
    if (!(await authorized(request, "PATCH"))) return unauthorized();
    if (!isQuoteEngineConfigured()) return setupRequired();

    const body = await readBody(request);
    const id = typeof body.id === "string" ? body.id : undefined;
    if (!id) {
      return json({ ok: false, error: "An inspection id is required." }, { status: 400 });
    }

    // Deleting one line is a PATCH rather than a DELETE method: the mount only
    // declares GET/POST/PATCH (see index.ts moduleMounts), and adding a method
    // to a shared route contract for one operation is not worth it.
    const deleteLineId = typeof body.delete_line_item_id === "string" ? body.delete_line_item_id : "";
    if (deleteLineId) {
      const removed = await deleteLineItem(id, deleteLineId);
      if (!removed) {
        return json(
          { ok: false, error: "That line could not be deleted. Generated lines are not removable." },
          { status: 400 },
        );
      }
      const inspection = await getInspection(id);
      return json({
        ok: true,
        id,
        inspection,
        lines: await listLineItems(id),
      });
    }

    const input = pickInspectionInput(body);

    // A PATCH carrying only `addons` or only `line_items` has no inspection
    // columns to write, and an empty PostgREST update matches no rows and comes
    // back as null — indistinguishable from "no such inspection". That made
    // every add-on-only and line-item-only save fail with a 404 while the
    // request was perfectly valid. Read the row instead of writing nothing to
    // it, and let the add-on / line work below proceed.
    const inspection = Object.keys(input).length
      ? await patchInspection(id, input)
      : await getInspection(id);
    if (!inspection) {
      return json({ ok: false, error: "Could not update the inspection." }, { status: 404 });
    }

    const addons = normalizeAddonInputs(body.addons);
    if (addons.length) await upsertAddons(id, addons);

    const manualLines = normalizeLineInputs(body.line_items);
    if (manualLines) await upsertLineItems(id, manualLines);

    // Regenerate whenever the walkthrough's pricing inputs or the add-ons could
    // have moved. Skipping it would leave the base line priced from the OLD
    // sqft while the row says the new one — the exact drift the generator model
    // exists to prevent. `regenerate_lines: false` opts out for a metadata-only
    // patch (a status change, a note) where the walkthrough did not move.
    const skipRegenerate = body.regenerate_lines === false || body.regenerate_lines === "false";
    const lines = skipRegenerate ? await listLineItems(id) : await regenerateQuoteLines(id);
    const priced = (await getInspection(id)) ?? inspection;

    return json({ ok: true, id: priced.id, inspection: priced, lines });
  }

  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isQuoteEngineConfigured()) return setupRequired();

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return json({ ok: false, error: "An inspection id is required." }, { status: 400 });
    }

    const inspection = await getInspection(id);
    if (!inspection) {
      return json({ ok: false, error: "Inspection not found." }, { status: 404 });
    }

    const [addons, lines] = await Promise.all([getAddons(id), listLineItems(id)]);

    if (url.searchParams.get("pdf") === "1") {
      const pdf = await generateQuotePdf(inspection, addons, options.provider, options.labels, lines);
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${quotePdfFilename(inspection.prospect_company)}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return json({ ok: true, inspection, addons, lines });
  }

  return { GET, POST, PATCH };
}

// --- customer-facing quote route ------------------------------------------

export interface PublicQuoteRouteOptions {
  /** Provider/brand details stamped onto the customer's PDF download. */
  provider: QuoteProvider;
  /** Per-client wording on the quote document. See ./labels.ts. */
  labels?: Partial<QuoteLabels> | null;
  /**
   * Fired once, after a quote is successfully accepted. This is the
   * convert-to-invoice seam.
   *
   * A HOOK rather than a direct billing import on purpose: modules are bolt-on
   * per client.config.ts, and a client can enable quote-engine without enabling
   * billing. The app composes the two (see
   * module-billing/src/quote-conversion.ts); quote-engine stays unaware of
   * whether an invoice exists at all.
   *
   * Failures here are logged and swallowed. The customer has already accepted
   * and that fact is committed — refusing their acceptance because an invoice
   * could not be drafted would be the wrong trade, and the accept is not
   * retryable ('accepted' is terminal).
   */
  onAccepted?: (inspection: Inspection, addons: QuoteAddon[]) => void | Promise<void>;
}

/** Next passes route params as a promise in 16; older shapes are still plain. */
type TokenContext = {
  params: { token: string } | Promise<{ token: string }>;
};

async function tokenFrom(context: TokenContext | undefined): Promise<string> {
  const params = await Promise.resolve(context?.params);
  return typeof params?.token === "string" ? params.token : "";
}

/**
 * Route-handler factory for the customer-facing quote link,
 * `/api/quote/[token]`. The consuming app re-exports GET/POST from
 * `app/api/quote/[token]/route.ts`.
 *
 * UNLIKE createInspectionRouteHandlers, this factory takes no `authorize`
 * callback — the public_token IS the credential, and the customer has no
 * account to authenticate against. Everything the token buys is scoped to one
 * inspection, and the reply is the allow-listed PublicQuoteView, never the raw
 * row. anon still holds no grant or policy on `inspections`; the read happens
 * through the service-role client after the token resolves.
 *
 *   GET   render the quote (marks it viewed), or stream its PDF with ?pdf=1
 *   POST  { response: "accepted" | "declined" }
 */
export function createPublicQuoteRouteHandlers(options: PublicQuoteRouteOptions) {
  // A miss and a malformed token return the SAME 404 body. Distinguishing them
  // would confirm to a prober that a token was well-formed but unknown.
  const notFound = () =>
    json(
      { ok: false, error: "This quote link is not valid." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );

  async function GET(request: Request, context?: TokenContext): Promise<Response> {
    if (!isQuoteEngineConfigured()) return setupRequired();

    const token = await tokenFrom(context);
    const inspection = await getInspectionByToken(token);
    if (!inspection) return notFound();

    // A quote that was never sent has no customer-facing existence. Same 404 as
    // an unknown token — a draft's contents are not the customer's to preview.
    if (inspection.status === "drafting" || inspection.status === "ready_to_send") {
      return notFound();
    }

    // Best effort, and deliberately not awaited for its result: a failed
    // view-stamp must never stop the customer seeing their quote.
    await recordQuoteViewed(token);

    const [addons, lines] = await Promise.all([
      getAddons(inspection.id),
      listLineItems(inspection.id),
    ]);

    if (new URL(request.url).searchParams.get("pdf") === "1") {
      const pdf = await generateQuotePdf(inspection, addons, options.provider, options.labels, lines);
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${quotePdfFilename(inspection.prospect_company)}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return json(
      { ok: true, quote: toPublicQuoteView(inspection, addons, lines) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  async function POST(request: Request, context?: TokenContext): Promise<Response> {
    if (!isQuoteEngineConfigured()) return setupRequired();

    const token = await tokenFrom(context);
    const body = await readBody(request);
    const response = body.response;

    if (response !== "accepted" && response !== "declined") {
      return json(
        { ok: false, error: "A response of 'accepted' or 'declined' is required." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const result = await respondToQuote(token, response);
    if (result.ok) {
      const [addons, lines] = await Promise.all([
        getAddons(result.inspection.id),
        listLineItems(result.inspection.id),
      ]);

      if (response === "accepted" && options.onAccepted) {
        try {
          await options.onAccepted(result.inspection, addons);
        } catch (error) {
          // Swallowed deliberately — see PublicQuoteRouteOptions.onAccepted.
          // The acceptance is already committed and 'accepted' is terminal, so
          // there is nothing to roll back to and nothing for the customer to
          // retry. Staff reconcile a missing invoice from the accepted list.
          console.warn("[Quote engine] onAccepted hook failed:", error);
        }
      }

      return json(
        { ok: true, quote: toPublicQuoteView(result.inspection, addons, lines) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const headers = { "Cache-Control": "no-store" };
    switch (result.reason) {
      case "not_found":
        return notFound();
      case "expired":
        return json(
          { ok: false, error: "This quote has expired. Contact us for an updated quote." },
          { status: 409, headers },
        );
      case "already_responded":
        return json(
          { ok: false, error: "This quote has already been answered." },
          { status: 409, headers },
        );
      default:
        return json(
          { ok: false, error: "Could not record your response. Please try again." },
          { status: 500, headers },
        );
    }
  }

  return { GET, POST };
}
