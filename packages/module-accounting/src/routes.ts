// Route-handler factory for /api/accounting. Staff-only; deny-by-default
// authorize callback required (absent → 401 on every handler).
//
//   GET  ?resource=sync-runs[&connector=tiller|wave][&status=...]
//        ?resource=account-map&connector=tiller|wave
//   POST ?action=run-sync       body: { connector }
//        ?action=upsert-map     body: { connector, internal_key, external_id, label? }

import "server-only";
import { timingSafeEqual } from "node:crypto";
import {
  countPendingOutbox,
  drainOutbox,
  getExportSettings,
  isAccountingConfigured,
  listAccountMap,
  listOutboxEvents,
  listSyncRuns,
  runScheduledExportIfDue,
  runSync,
  retryFailedOutboxEvent,
  saveExportSchedule,
  storeWaveOAuthCredentials,
  upsertAccountMap,
  type ListSyncRunsFilter,
} from "./server";
import {
  buildWaveAuthorizeUrl,
  exchangeWaveCode,
  fetchWaveBusinessId,
  isWaveOAuthEnvConfigured,
} from "./wave-oauth";
import { createWaveOAuthState, verifyWaveOAuthState } from "./wave-oauth-state";
import { CONNECTOR_NAMES, EXPORT_SCHEDULE_VALUES, OUTBOX_STATUSES } from "./types";
import type { ConnectorName, ExportSchedule, OutboxStatus, SyncStatus } from "./types";

const SYNC_STATUS_SET = new Set<string>([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

const MAX_LABEL_LENGTH = 512;
const MAX_KEY_LENGTH = 256;
const MAX_EXTERNAL_ID_LENGTH = 512;

export interface AccountingRouteOptions {
  /**
   * Called before EVERY handler. Return true to allow the request. When
   * absent, all requests are rejected with 401. Accounting routes are
   * staff-only and served via the service-role client (RLS is bypassed), so
   * the route layer is the only gate.
   */
  authorize?: (
    request: Request,
    method: "GET" | "POST",
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
      error: "Accounting is not configured. Contact your administrator.",
    },
    { status: 503 },
  );
}

function badRequest(error: string): Response {
  return json({ ok: false, error }, { status: 400 });
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
  if (!formData) return {};
  return Object.fromEntries(formData.entries());
}

function isValidConnector(value: unknown): value is ConnectorName {
  return CONNECTOR_NAMES.includes(value as ConnectorName);
}

function isValidUuid(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function createAccountingRouteHandlers(options: AccountingRouteOptions) {
  // Deny-by-default: with no authorize callback wired by the app, every
  // request is rejected. Accounting tables are staff-only and served via the
  // service-role client (RLS bypassed), so the route layer is the only gate.
  const authorized = (request: Request, method: "GET" | "POST") =>
    options.authorize
      ? Promise.resolve(options.authorize(request, method))
      : Promise.resolve(false);

  async function GET(request: Request): Promise<Response> {
    if (!(await authorized(request, "GET"))) return unauthorized();
    if (!isAccountingConfigured()) return setupRequired();

    const url = new URL(request.url);
    const resource = url.searchParams.get("resource") ?? "sync-runs";

    if (resource === "account-map") {
      const connector = url.searchParams.get("connector");
      if (!isValidConnector(connector)) {
        return badRequest(
          "connector is required and must be 'tiller' or 'wave'.",
        );
      }
      const rows = await listAccountMap(connector);
      return json({ ok: true, rows });
    }

    if (resource === "export-settings") {
      const settings = await getExportSettings();
      return json({ ok: true, settings });
    }

    if (resource === "outbox") {
      const statusParam = url.searchParams.get("status");
      if (statusParam !== null) {
        if (!OUTBOX_STATUSES.includes(statusParam as OutboxStatus)) {
          return badRequest(
            "status must be one of: pending, processing, done, failed.",
          );
        }
        const events = await listOutboxEvents(statusParam as OutboxStatus, 50);
        return json({ ok: true, events });
      }
      const pending = await countPendingOutbox();
      return json({ ok: true, pending });
    }

    // Default: sync-runs
    const filter: ListSyncRunsFilter = {};
    const connectorParam = url.searchParams.get("connector");
    if (connectorParam !== null) {
      if (!isValidConnector(connectorParam)) {
        return badRequest("connector must be 'tiller' or 'wave'.");
      }
      filter.connector = connectorParam;
    }
    const statusParam = url.searchParams.get("status");
    if (statusParam !== null) {
      if (!SYNC_STATUS_SET.has(statusParam)) {
        return badRequest(
          "status must be one of: pending, running, succeeded, failed, skipped.",
        );
      }
      filter.status = statusParam as SyncStatus;
    }

    const runs = await listSyncRuns(filter);
    return json({ ok: true, runs });
  }

  async function POST(request: Request): Promise<Response> {
    if (!(await authorized(request, "POST"))) return unauthorized();
    if (!isAccountingConfigured()) return setupRequired();

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (action === "run-sync") {
      const body = await readBody(request);
      const connector = body.connector;
      if (!isValidConnector(connector)) {
        return badRequest("connector must be 'tiller' or 'wave'.");
      }
      const result = await runSync(connector);
      return json(
        { ...result },
        { status: result.ok || result.skipped ? 200 : 500 },
      );
    }

    if (action === "drain-outbox" || action === "export-now") {
      const body = await readBody(request);
      const limitRaw = body.limit;
      const limit =
        typeof limitRaw === "number"
          ? Math.min(Math.max(1, limitRaw), 50)
          : 10;
      const result = await drainOutbox(limit);
      return json(result);
    }

    if (action === "save-export-schedule") {
      const body = await readBody(request);
      const schedule = body.schedule;
      if (
        typeof schedule !== "string" ||
        !EXPORT_SCHEDULE_VALUES.includes(schedule as ExportSchedule)
      ) {
        return badRequest(
          "schedule must be one of: manual, when_recorded, daily, weekly.",
        );
      }
      const settings = await saveExportSchedule(schedule as ExportSchedule);
      if (!settings) {
        return json(
          { ok: false, error: "Could not save export schedule." },
          { status: 500 },
        );
      }
      return json({ ok: true, settings });
    }

    if (action === "retry-export") {
      const body = await readBody(request);
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!isValidUuid(id)) {
        return badRequest("id must be a valid outbox event uuid.");
      }
      const result = await retryFailedOutboxEvent(id);
      if (!result.ok) {
        return json(
          { ok: false, error: result.error ?? "Could not retry export." },
          { status: 400 },
        );
      }
      const drain = await drainOutbox(1);
      return json({ ok: true, retried: id, drain });
    }

    if (action === "wave-oauth-url") {
      if (!isWaveOAuthEnvConfigured()) {
        return json(
          { ok: false, setupRequired: true, error: "Wave OAuth is not configured." },
          { status: 503 },
        );
      }
      const body = await readBody(request);
      const redirectUri =
        typeof body.redirect_uri === "string" && body.redirect_uri.trim()
          ? body.redirect_uri.trim()
          : `${url.origin}/api/accounting/oauth/wave`;
      const state = createWaveOAuthState();
      if (!state) {
        return json(
          {
            ok: false,
            setupRequired: true,
            error: "Wave OAuth state signing is not configured.",
          },
          { status: 503 },
        );
      }
      const authorizeUrl = buildWaveAuthorizeUrl(redirectUri, state);
      if (!authorizeUrl) {
        return json(
          { ok: false, error: "Could not build Wave authorize URL." },
          { status: 500 },
        );
      }
      return json({ ok: true, url: authorizeUrl, state });
    }

    if (action === "upsert-map") {
      const body = await readBody(request);
      const connector = body.connector;
      if (!isValidConnector(connector)) {
        return badRequest("connector must be 'tiller' or 'wave'.");
      }

      const internal_key = typeof body.internal_key === "string"
        ? body.internal_key.trim().slice(0, MAX_KEY_LENGTH)
        : null;
      if (!internal_key) {
        return badRequest("internal_key is required.");
      }

      const external_id = typeof body.external_id === "string"
        ? body.external_id.trim().slice(0, MAX_EXTERNAL_ID_LENGTH)
        : null;
      if (!external_id) {
        return badRequest("external_id is required.");
      }

      const label = typeof body.label === "string"
        ? body.label.slice(0, MAX_LABEL_LENGTH)
        : null;

      const row = await upsertAccountMap(connector, internal_key, external_id, label);
      if (!row) {
        return json(
          { ok: false, error: "Could not upsert account map entry." },
          { status: 500 },
        );
      }
      return json({ ok: true, row }, { status: 200 });
    }

    // Unknown or missing action.
    return badRequest(
      "action is required. Valid values: run-sync, export-now, save-export-schedule, retry-export, wave-oauth-url, upsert-map.",
    );
  }

  return { GET, POST };
}

export interface WaveOAuthCallbackOptions {
  redirectUri: string;
  successPath?: string;
}

export function createWaveOAuthCallbackHandler(
  options: WaveOAuthCallbackOptions,
) {
  async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const successPath = options.successPath ?? "/accounting";

    if (error) {
      return Response.redirect(
        `${successPath}?wave=error`,
        302,
      );
    }

    if (!code || !state) {
      return Response.redirect(`${successPath}?wave=invalid`, 302);
    }

    if (!verifyWaveOAuthState(state)) {
      return Response.redirect(`${successPath}?wave=invalid`, 302);
    }

    const tokens = await exchangeWaveCode(code, options.redirectUri);
    if (!tokens) {
      return Response.redirect(`${successPath}?wave=exchange_failed`, 302);
    }

    const accessToken =
      typeof tokens.access_token === "string" ? tokens.access_token : null;
    if (accessToken) {
      const businessId = await fetchWaveBusinessId(accessToken);
      if (businessId) {
        tokens.business_id = businessId;
      }
    }

    const stored = await storeWaveOAuthCredentials(tokens, options.redirectUri);
    if (!stored.ok) {
      return Response.redirect(
        `${successPath}?wave=${stored.setupRequired ? "setup_required" : "store_failed"}`,
        302,
      );
    }

    return Response.redirect(`${successPath}?wave=connected`, 302);
  }

  return { GET };
}

export interface AccountingCronOptions {
  /** When false, cron requests are rejected (503). Defaults to true. */
  enabled?: boolean;
}

/**
 * Secret-gated cron handler for Vercel Cron (or any scheduler). Compares the
 * Authorization Bearer token to the configured secret.
 */
export function createAccountingCronHandler(
  options: AccountingCronOptions = {},
) {
  async function GET(request: Request): Promise<Response> {
    if (options.enabled === false) {
      return json({ ok: false, error: "Cron is disabled." }, { status: 503 });
    }

    const secret =
      process.env.ACCOUNTING_CRON_SECRET?.trim() ??
      process.env.CRON_SECRET?.trim();
    if (!secret) {
      return json(
        {
          ok: false,
          setupRequired: true,
          error: "Accounting cron is not configured. Contact your administrator.",
        },
        { status: 503 },
      );
    }

    if (!isAccountingConfigured()) return setupRequired();

    const url = new URL(request.url);
    const bearer = request.headers.get("authorization");
    const token =
      bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length).trim() : null;

    const tokenBuf = token ? Buffer.from(token) : null;
    const secretBuf = Buffer.from(secret);
    if (
      !tokenBuf ||
      tokenBuf.length !== secretBuf.length ||
      !timingSafeEqual(tokenBuf, secretBuf)
    ) {
      return unauthorized();
    }

    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Math.min(Math.max(1, Number(limitRaw) || 10), 50) : 25;
    const result = await runScheduledExportIfDue(limit);
    return json(result);
  }

  return { GET };
}

// Validate UUID helper exposed for apps that want to pass ids via route
// params. Not used internally but re-exported for convenience.
export { isValidUuid };
