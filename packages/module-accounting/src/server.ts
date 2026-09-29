// Service-role data access for the accounting module. ledger_sync_log and
// ledger_account_map are staff/service-role managed (no anon/authenticated
// RLS policies), so all reads and writes here use the service-role key,
// which bypasses RLS. Guard every call with isAccountingConfigured() and
// degrade gracefully when env is missing — mirrors the quote-engine's
// isQuoteEngineConfigured posture.

import "server-only";
import { isServiceRoleConfigured } from "@waltersignal/bananaforce-data-supabase/service";
import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import {
  isTillerConfigured,
  isWaveOAuthEnvConfigured,
  selectConnector,
  waveConnectorStatus,
  type SyncResult,
} from "./connectors";
import { encodeStoredCredentials, isCredentialsEncryptionConfigured } from "./credentials";
import { ledgerIdempotencyKey } from "./tiller-export";
import {
  isScheduledExportDue,
  shouldExportWhenRecorded,
} from "./export-schedule";
import { nextSyncStatus } from "./sync";
import type {
  ConnectorName,
  EnqueueLedgerEventInput,
  EnqueueLedgerEventResult,
  ExportSchedule,
  ExportSettings,
  LedgerAccountMap,
  LedgerEntityMap,
  LedgerEntityType,
  LedgerEventPayload,
  LedgerEventType,
  LedgerOutboxEvent,
  LedgerSyncLog,
  OutboxStatus,
  SyncDirection,
  SyncStatus,
  SyncTrigger,
} from "./types";
import {
  CONNECTOR_NAMES,
  DEFAULT_ACCOUNT_MAP_ENTRIES,
  EXPORT_SCHEDULE_VALUES,
  LEDGER_ENTITY_TYPES,
  LEDGER_EVENT_TYPES,
  OUTBOX_STATUSES,
  SYNC_STATUSES,
} from "./types";
import { reapStuckOutboxEvents } from "./outbox-reaper";

type SyncLogRow = Record<string, unknown>;

const MAX_ERROR_LENGTH = 2048;
const MAX_LABEL_LENGTH = 512;
const MAX_KEY_LENGTH = 256;
const MAX_EXTERNAL_ID_LENGTH = 512;

// Defense-in-depth UUID guard at the data layer (routes validate too).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const MODULE_LABEL = "Accounting";

const warn = (operation: string, error: unknown) =>
  warnSupabase(MODULE_LABEL, operation, error);

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function statusOrPending(value: unknown): SyncStatus {
  return SYNC_STATUSES.includes(value as SyncStatus)
    ? (value as SyncStatus)
    : "pending";
}

function connectorOrNull(value: unknown): ConnectorName | null {
  return CONNECTOR_NAMES.includes(value as ConnectorName)
    ? (value as ConnectorName)
    : null;
}

/**
 * Env-only check (no I/O). Returns true when the service-role key is
 * configured. The module degrades to setup-required empties without it.
 */
export function isAccountingConfigured(): boolean {
  return isServiceRoleConfigured();
}

/**
 * Returns the connector configuration status for the UI.
 */
export async function connectorStatus(): Promise<{
  tiller: boolean;
  wave: boolean;
}> {
  return {
    tiller: isTillerConfigured(),
    wave: await waveConnectorStatus(() => loadConnectorCredentialsBlob("wave")),
  };
}

function connectorDeps() {
  return {
    loadWaveCredentials: () => loadConnectorCredentialsBlob("wave"),
    saveWaveCredentials: (blob: string) =>
      saveConnectorCredentials("wave", blob),
    resolveCategory: async (
      _eventType: LedgerEventType,
      defaultCategory: string,
    ) => {
      const rows = await listAccountMap("tiller");
      const match = rows.find((row) => row.internal_key === defaultCategory);
      const external = match?.external_id?.trim();
      return external || undefined;
    },
  };
}

const getServiceClient = (operation: string) =>
  getServiceClientOrNull(MODULE_LABEL, operation);

function syncLogFromRow(row: SyncLogRow): LedgerSyncLog {
  const direction = row.direction;
  const trigger = row.trigger_source;
  return {
    id: stringOrNull(row.id) ?? "",
    connector: (connectorOrNull(row.connector) ?? "tiller") as ConnectorName,
    status: statusOrPending(row.status),
    started_at: stringOrNull(row.started_at) ?? new Date().toISOString(),
    finished_at: stringOrNull(row.finished_at),
    records_synced: numberOrNull(row.records_synced) ?? 0,
    error: stringOrNull(row.error),
    direction:
      direction === "inbound" || direction === "outbound" ? direction : null,
    trigger_source:
      trigger === "manual" || trigger === "event" || trigger === "cron"
        ? trigger
        : null,
    idempotency_key: stringOrNull(row.idempotency_key),
    created_at: stringOrNull(row.created_at) ?? "",
  };
}

function accountMapFromRow(row: SyncLogRow): LedgerAccountMap {
  return {
    id: stringOrNull(row.id) ?? "",
    connector: (connectorOrNull(row.connector) ?? "tiller") as ConnectorName,
    internal_key: stringOrNull(row.internal_key) ?? "",
    external_id: stringOrNull(row.external_id) ?? "",
    label: stringOrNull(row.label),
    created_at: stringOrNull(row.created_at) ?? "",
  };
}

// --- ledger_sync_log -------------------------------------------------------

/**
 * Inserts a new sync log row in the 'running' state. Returns the row or
 * null when the service client is unavailable.
 */
export async function startSyncRun(
  connector: ConnectorName,
  options: {
    direction?: SyncDirection;
    trigger?: SyncTrigger;
    idempotencyKey?: string | null;
  } = {},
): Promise<LedgerSyncLog | null> {
  const supabase = getServiceClient("startSyncRun");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("ledger_sync_log")
    .insert({
      connector,
      status: "running",
      started_at: new Date().toISOString(),
      direction: options.direction ?? "outbound",
      trigger_source: options.trigger ?? "manual",
      idempotency_key: options.idempotencyKey ?? null,
    })
    .select("*")
    .single();

  if (error) {
    warn("startSyncRun", error);
    return null;
  }
  return data ? syncLogFromRow(data as SyncLogRow) : null;
}

/**
 * Updates a sync log row with the outcome of the run. Returns the updated
 * row or null on failure.
 */
export async function finishSyncRun(
  id: string,
  outcome: {
    status: SyncStatus;
    recordsSynced?: number;
    error?: string | null;
  },
): Promise<LedgerSyncLog | null> {
  const supabase = getServiceClient("finishSyncRun");
  if (!supabase) return null;
  if (!isValidUuid(id)) return null;

  const patch: SyncLogRow = {
    status: outcome.status,
    finished_at: new Date().toISOString(),
    records_synced: outcome.recordsSynced ?? 0,
    error: outcome.error
      ? String(outcome.error).slice(0, MAX_ERROR_LENGTH)
      : null,
  };

  const { data, error } = await supabase
    .from("ledger_sync_log")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    warn("finishSyncRun", error);
    return null;
  }
  return data ? syncLogFromRow(data as SyncLogRow) : null;
}

// A run that never finalized (the finish-write failed, or the process died
// mid-sync) is stuck in 'running'. Anything older than this is certainly not a
// live run — connectors are fast, and even the real APIs are minutes, not hours.
const STALE_RUN_MS = 15 * 60 * 1000;

/**
 * Reconcile sync runs orphaned in 'running': mark any whose started_at is older
 * than maxAgeMs as 'failed'. Idempotent and bounded; returns the count reaped
 * (0 when the client is unavailable or none are stale). Called opportunistically
 * at the start of runSync so stuck rows self-heal on the next sync without a cron.
 */
export async function reapStaleRuns(maxAgeMs: number = STALE_RUN_MS): Promise<number> {
  const supabase = getServiceClient("reapStaleRuns");
  if (!supabase) return 0;

  const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();
  const { data, error } = await supabase
    .from("ledger_sync_log")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: "Run did not finalize (reaped as stale).",
    })
    .eq("status", "running")
    .lt("started_at", cutoffIso)
    .select("id");

  if (error) {
    warn("reapStaleRuns", error);
    return 0;
  }
  return (data ?? []).length;
}

export interface ListSyncRunsFilter {
  connector?: ConnectorName;
  status?: SyncStatus;
}

/** Returns sync log rows, newest first, optionally filtered. */
export async function listSyncRuns(
  filter: ListSyncRunsFilter = {},
): Promise<LedgerSyncLog[]> {
  const supabase = getServiceClient("listSyncRuns");
  if (!supabase) return [];

  let query = supabase
    .from("ledger_sync_log")
    .select("*")
    .order("started_at", { ascending: false });

  if (filter.connector) {
    query = query.eq("connector", filter.connector);
  }
  if (filter.status) {
    query = query.eq("status", filter.status);
  }

  const { data, error } = await query;
  if (error) {
    warn("listSyncRuns", error);
    return [];
  }
  return ((data ?? []) as SyncLogRow[]).map(syncLogFromRow);
}

// --- ledger_account_map ----------------------------------------------------

/** Insert default map rows when missing (does not overwrite staff edits). */
export async function seedMissingAccountMapDefaults(
  connector: ConnectorName,
): Promise<void> {
  const supabase = getServiceClient("seedMissingAccountMapDefaults");
  if (!supabase) return;

  const rows = DEFAULT_ACCOUNT_MAP_ENTRIES.map((entry) => ({
    connector,
    internal_key: entry.internal_key,
    external_id:
      connector === "wave" ? entry.internal_key : entry.external_id,
    label: entry.label,
  }));

  const { error } = await supabase
    .from("ledger_account_map")
    .upsert(rows, { onConflict: "connector,internal_key", ignoreDuplicates: true });

  if (error) warn("seedMissingAccountMapDefaults", error);
}

/** Returns account map rows for a given connector. */
export async function listAccountMap(
  connector: ConnectorName,
  options: { seedDefaults?: boolean } = {},
): Promise<LedgerAccountMap[]> {
  const supabase = getServiceClient("listAccountMap");
  if (!supabase) return [];

  if (options.seedDefaults !== false) {
    await seedMissingAccountMapDefaults(connector);
  }

  const { data, error } = await supabase
    .from("ledger_account_map")
    .select("*")
    .eq("connector", connector)
    .order("internal_key", { ascending: true });

  if (error) {
    warn("listAccountMap", error);
    return [];
  }
  return ((data ?? []) as SyncLogRow[]).map(accountMapFromRow);
}

/**
 * Upserts an account map row. Conflicts on (connector, internal_key) update
 * the external_id and label. Returns the upserted row or null on failure.
 */
export async function upsertAccountMap(
  connector: ConnectorName,
  internal_key: string,
  external_id: string,
  label?: string | null,
): Promise<LedgerAccountMap | null> {
  const supabase = getServiceClient("upsertAccountMap");
  if (!supabase) return null;

  const row = {
    connector,
    internal_key: internal_key.slice(0, MAX_KEY_LENGTH),
    external_id: external_id.slice(0, MAX_EXTERNAL_ID_LENGTH),
    label: label ? label.slice(0, MAX_LABEL_LENGTH) : null,
  };

  const { data, error } = await supabase
    .from("ledger_account_map")
    .upsert(row, { onConflict: "connector,internal_key" })
    .select("*")
    .maybeSingle();

  if (error) {
    warn("upsertAccountMap", error);
    return null;
  }
  return data ? accountMapFromRow(data as SyncLogRow) : null;
}

// --- sync orchestration ----------------------------------------------------

export interface RunSyncResult {
  ok: boolean;
  skipped?: boolean;
  runId?: string;
  recordsSynced?: number;
  error?: string;
}

/**
 * Orchestrates a full sync run: starts the log row, calls the connector,
 * then finishes the log row with the outcome. Returns a summary of the run.
 * Degrades gracefully — never throws to the caller.
 */
export async function runSync(connector: ConnectorName): Promise<RunSyncResult> {
  const conn = selectConnector(connector, connectorDeps());
  if (!conn) {
    return { ok: false, error: "Unknown connector." };
  }

  // Opportunistically reconcile any runs orphaned in 'running' by a prior
  // failed finish-write. Best-effort — a reaper failure must never block a sync.
  await reapStaleRuns().catch(() => 0);

  const logRow = await startSyncRun(connector);
  if (!logRow) {
    // Service client unavailable — run the connector anyway for the result,
    // but we cannot persist the log. This is a setup-required degrade path.
    const result: SyncResult = await conn.sync().catch(() => ({
      ok: false,
      skipped: true,
    }));
    return {
      ok: result.ok,
      skipped: result.skipped,
      recordsSynced: result.recordsSynced,
      error: result.error,
    };
  }

  let connResult: { ok: boolean; skipped?: boolean; recordsSynced?: number; error?: string };
  try {
    connResult = await conn.sync();
  } catch (err) {
    connResult = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Derive the terminal status through the shared transition guard so the
  // route and the orchestrator can never diverge on what 'running' resolves to.
  const event = connResult.skipped ? "skip" : connResult.ok ? "succeed" : "fail";
  const finalStatus = nextSyncStatus("running", event) ?? "failed";

  const finished = await finishSyncRun(logRow.id, {
    status: finalStatus,
    recordsSynced: connResult.recordsSynced ?? 0,
    error: connResult.error ?? null,
  });
  // If the finish-write failed, the log row is left in 'running'. Surface it;
  // reapStaleRuns() (above, next run) reconciles it to 'failed' once it ages out.
  if (!finished) {
    warn("runSync", `could not finalize sync run ${logRow.id} (left running)`);
  }

  return {
    ok: connResult.ok,
    skipped: connResult.skipped,
    runId: logRow.id,
    recordsSynced: connResult.recordsSynced,
    error: connResult.error,
  };
}

// --- connector credentials -------------------------------------------------

export async function loadConnectorCredentialsBlob(
  connector: ConnectorName,
): Promise<string | null> {
  const supabase = getServiceClient("loadConnectorCredentialsBlob");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("connector_credentials")
    .select("credentials_encrypted")
    .eq("connector", connector)
    .maybeSingle();

  if (error) {
    warn("loadConnectorCredentialsBlob", error);
    return null;
  }
  return stringOrNull(
    (data as SyncLogRow | null)?.credentials_encrypted,
  );
}

export async function saveConnectorCredentials(
  connector: ConnectorName,
  credentialsEncrypted: string,
): Promise<boolean> {
  const supabase = getServiceClient("saveConnectorCredentials");
  if (!supabase) return false;

  const { error } = await supabase.from("connector_credentials").upsert(
    {
      connector,
      credentials_encrypted: credentialsEncrypted,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connector" },
  );

  if (error) {
    warn("saveConnectorCredentials", error);
    return false;
  }
  return true;
}

export type StoreWaveOAuthCredentialsResult =
  | { ok: true }
  | { ok: false; setupRequired: true; error: string };

export async function storeWaveOAuthCredentials(
  tokenResponse: Record<string, unknown>,
  redirectUri: string,
): Promise<StoreWaveOAuthCredentialsResult> {
  if (!isCredentialsEncryptionConfigured()) {
    const error = "CONNECTOR_CREDENTIALS_KEY is required to store Wave OAuth credentials.";
    warn("storeWaveOAuthCredentials", error);
    return { ok: false, setupRequired: true, error };
  }

  const blob = encodeStoredCredentials({
    ...tokenResponse,
    redirect_uri: redirectUri,
  });
  if (!blob) {
    return {
      ok: false,
      setupRequired: true,
      error: "Wave OAuth credential encryption is not configured.",
    };
  }
  return (await saveConnectorCredentials("wave", blob))
    ? { ok: true }
    : {
        ok: false,
        setupRequired: true,
        error: "Could not store Wave OAuth credentials.",
      };
}

// --- ledger_outbox -----------------------------------------------------------

const MAX_OUTBOX_ATTEMPTS = 5;

function outboxFromRow(row: SyncLogRow): LedgerOutboxEvent {
  const payload = row.payload;
  return {
    id: stringOrNull(row.id) ?? "",
    event_type: (LEDGER_EVENT_TYPES.includes(row.event_type as LedgerEventType)
      ? row.event_type
      : "payment.succeeded") as LedgerEventType,
    source_module: stringOrNull(row.source_module) ?? "",
    source_id: stringOrNull(row.source_id) ?? "",
    payload:
      typeof payload === "object" && payload !== null
        ? (payload as LedgerEventPayload)
        : {},
    status: OUTBOX_STATUSES.includes(row.status as OutboxStatus)
      ? (row.status as OutboxStatus)
      : "pending",
    attempts: numberOrNull(row.attempts) ?? 0,
    last_error: stringOrNull(row.last_error),
    idempotency_key: stringOrNull(row.idempotency_key) ?? "",
    created_at: stringOrNull(row.created_at) ?? "",
    processed_at: stringOrNull(row.processed_at),
  };
}

export async function countPendingOutbox(): Promise<number> {
  return countOutboxByStatus("pending");
}

export async function countFailedOutbox(): Promise<number> {
  return countOutboxByStatus("failed");
}

async function countOutboxByStatus(status: OutboxStatus): Promise<number> {
  const supabase = getServiceClient("countOutboxByStatus");
  if (!supabase) return 0;

  const { count, error } = await supabase
    .from("ledger_outbox")
    .select("*", { count: "exact", head: true })
    .eq("status", status);

  if (error) {
    warn("countOutboxByStatus", error);
    return 0;
  }
  return count ?? 0;
}

export async function listOutboxEvents(
  status: OutboxStatus = "pending",
  limit = 25,
): Promise<LedgerOutboxEvent[]> {
  const supabase = getServiceClient("listOutboxEvents");
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("ledger_outbox")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    warn("listOutboxEvents", error);
    return [];
  }
  return ((data ?? []) as SyncLogRow[]).map(outboxFromRow);
}

export async function enqueueLedgerEventInternal(
  input: EnqueueLedgerEventInput,
): Promise<EnqueueLedgerEventResult> {
  if (!isAccountingConfigured()) {
    return { ok: false, skipped: true };
  }

  if (
    !LEDGER_EVENT_TYPES.includes(input.eventType) ||
    !input.sourceModule.trim() ||
    !input.sourceId.trim()
  ) {
    return { ok: false, skipped: true };
  }

  const supabase = getServiceClient("enqueueLedgerEventInternal");
  if (!supabase) return { ok: false, skipped: true };

  const idempotency_key = ledgerIdempotencyKey(
    input.eventType,
    input.sourceModule.trim(),
    input.sourceId.trim(),
  );

  const { data, error } = await supabase
    .from("ledger_outbox")
    .insert({
      event_type: input.eventType,
      source_module: input.sourceModule.trim().slice(0, MAX_KEY_LENGTH),
      source_id: input.sourceId.trim().slice(0, MAX_KEY_LENGTH),
      payload: input.payload ?? {},
      idempotency_key,
      status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { ok: true, duplicate: true };
    }
    warn("enqueueLedgerEventInternal", error);
    return { ok: false, skipped: true };
  }

  const id = stringOrNull((data as SyncLogRow | null)?.id);
  return { ok: true, id: id ?? undefined };
}

async function finishOutboxEvent(
  id: string,
  outcome: { status: OutboxStatus; error?: string | null },
): Promise<void> {
  const supabase = getServiceClient("finishOutboxEvent");
  if (!supabase || !isValidUuid(id)) return;

  const patch: SyncLogRow = {
    status: outcome.status,
    last_error: outcome.error
      ? String(outcome.error).slice(0, MAX_ERROR_LENGTH)
      : null,
    processed_at:
      outcome.status === "done" ? new Date().toISOString() : null,
  };

  const { error } = await supabase
    .from("ledger_outbox")
    .update(patch)
    .eq("id", id);

  if (error) warn("finishOutboxEvent", error);
}

async function processOutboxEvent(
  event: LedgerOutboxEvent,
): Promise<{ ok: boolean; error?: string; defer?: boolean }> {
  const deps = connectorDeps();
  const waveBlob = await loadConnectorCredentialsBlob("wave");
  const tillerReady = isTillerConfigured();
  const waveReady = isWaveOAuthEnvConfigured() && Boolean(waveBlob);

  if (!tillerReady && !waveReady) {
    return {
      ok: false,
      defer: true,
      error: "No accounting connectors configured.",
    };
  }

  const connectors = (["tiller", "wave"] as const)
    .map((name) => selectConnector(name, deps))
    .filter((c): c is NonNullable<typeof c> => c !== null);

  let anyAttempted = false;
  let anySucceeded = false;
  let lastError: string | undefined;

  for (const connector of connectors) {
    if (connector.name === "tiller" && !tillerReady) continue;
    if (connector.name === "wave" && !waveReady) continue;

    anyAttempted = true;

    const logRow = await startSyncRun(connector.name, {
      direction: "outbound",
      trigger: "event",
      idempotencyKey: event.idempotency_key,
    });

    let pushResult;
    try {
      pushResult = await connector.pushEvent(event);
    } catch (err) {
      pushResult = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (logRow) {
      const transition = pushResult.skipped
        ? "skip"
        : pushResult.ok
          ? "succeed"
          : "fail";
      await finishSyncRun(logRow.id, {
        status: nextSyncStatus("running", transition) ?? "failed",
        recordsSynced: pushResult.recordsSynced ?? 0,
        error: pushResult.error ?? null,
      });
    }

    if (pushResult.skipped) continue;
    if (pushResult.ok) {
      anySucceeded = true;
    } else {
      lastError = pushResult.error;
    }
  }

  if (!anyAttempted) {
    return {
      ok: false,
      defer: true,
      error: "No accounting connectors configured.",
    };
  }
  if (anySucceeded) {
    return { ok: true };
  }
  return { ok: false, error: lastError ?? "All connectors failed." };
}

export interface DrainOutboxResult {
  ok: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  skipped?: boolean;
}

export async function drainOutbox(limit = 10): Promise<DrainOutboxResult> {
  if (!isAccountingConfigured()) {
    return { ok: false, processed: 0, succeeded: 0, failed: 0, skipped: true };
  }

  await reapStuckOutboxEvents().catch(() => 0);

  const events = await listOutboxEvents("pending", limit);
  if (events.length === 0) {
    return { ok: true, processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const event of events) {
    const supabase = getServiceClient("drainOutbox");
    if (!supabase) break;

    const { data: claimed } = await supabase
      .from("ledger_outbox")
      .update({
        status: "processing",
        attempts: event.attempts + 1,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", event.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (!claimed) continue;

    const claimedEvent = outboxFromRow(claimed as SyncLogRow);
    const result = await processOutboxEvent(claimedEvent);

    if (result.ok) {
      succeeded += 1;
      await finishOutboxEvent(claimedEvent.id, { status: "done" });
    } else if (result.defer) {
      await supabase
        .from("ledger_outbox")
        .update({
          status: "pending",
          attempts: event.attempts,
          claimed_at: null,
          last_error: result.error?.slice(0, MAX_ERROR_LENGTH) ?? null,
        })
        .eq("id", claimedEvent.id);
    } else {
      failed += 1;
      const attempts = claimedEvent.attempts + 1;
      const terminal = attempts >= MAX_OUTBOX_ATTEMPTS;
      await supabase
        .from("ledger_outbox")
        .update({
          status: terminal ? "failed" : "pending",
          claimed_at: null,
          last_error: result.error?.slice(0, MAX_ERROR_LENGTH) ?? null,
          processed_at: terminal ? new Date().toISOString() : null,
        })
        .eq("id", claimedEvent.id);
    }
  }

  return {
    ok: true,
    processed: succeeded + failed,
    succeeded,
    failed,
  };
}

/** Reset a failed outbox row to pending for manual retry. */
export async function retryFailedOutboxEvent(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isValidUuid(id)) {
    return { ok: false, error: "Invalid outbox event id." };
  }

  const supabase = getServiceClient("retryFailedOutboxEvent");
  if (!supabase) {
    return { ok: false, error: "Accounting is not configured." };
  }

  const { data, error } = await supabase
    .from("ledger_outbox")
    .update({
      status: "pending",
      attempts: 0,
      claimed_at: null,
      last_error: null,
      processed_at: null,
    })
    .eq("id", id)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();

  if (error) {
    warn("retryFailedOutboxEvent", error);
    return { ok: false, error: "Could not retry outbox event." };
  }

  if (!data) {
    return { ok: false, error: "Outbox event is not failed or was not found." };
  }

  return { ok: true };
}

// --- export automation schedule --------------------------------------------

const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  schedule: "when_recorded",
  last_automatic_export_at: null,
  updated_at: new Date(0).toISOString(),
};

function exportScheduleOrDefault(value: unknown): ExportSchedule {
  return EXPORT_SCHEDULE_VALUES.includes(value as ExportSchedule)
    ? (value as ExportSchedule)
    : "when_recorded";
}

function exportSettingsFromRow(row: SyncLogRow): ExportSettings {
  return {
    schedule: exportScheduleOrDefault(row.schedule),
    last_automatic_export_at: stringOrNull(row.last_automatic_export_at),
    updated_at: stringOrNull(row.updated_at) ?? new Date().toISOString(),
  };
}

export async function getExportSettings(): Promise<ExportSettings> {
  const supabase = getServiceClient("getExportSettings");
  if (!supabase) return DEFAULT_EXPORT_SETTINGS;

  const { data, error } = await supabase
    .from("ledger_export_settings")
    .select("schedule, last_automatic_export_at, updated_at")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    warn("getExportSettings", error);
    return DEFAULT_EXPORT_SETTINGS;
  }
  return data
    ? exportSettingsFromRow(data as SyncLogRow)
    : DEFAULT_EXPORT_SETTINGS;
}

export async function saveExportSchedule(
  schedule: ExportSchedule,
): Promise<ExportSettings | null> {
  if (!EXPORT_SCHEDULE_VALUES.includes(schedule)) {
    return null;
  }

  const supabase = getServiceClient("saveExportSchedule");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("ledger_export_settings")
    .upsert(
      {
        id: "default",
        schedule,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("schedule, last_automatic_export_at, updated_at")
    .maybeSingle();

  if (error) {
    warn("saveExportSchedule", error);
    return null;
  }
  return data ? exportSettingsFromRow(data as SyncLogRow) : null;
}

async function markAutomaticExportRun(): Promise<void> {
  const supabase = getServiceClient("markAutomaticExportRun");
  if (!supabase) return;

  const { error } = await supabase
    .from("ledger_export_settings")
    .update({
      last_automatic_export_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");

  if (error) warn("markAutomaticExportRun", error);
}

export async function shouldAutoExportOnRecord(): Promise<boolean> {
  const settings = await getExportSettings();
  return shouldExportWhenRecorded(settings.schedule);
}

export interface ScheduledExportResult extends DrainOutboxResult {
  schedule?: ExportSchedule;
  notDue?: boolean;
}

/** Batch export when daily/weekly schedule is due (called from cron). */
export async function runScheduledExportIfDue(
  limit = 50,
): Promise<ScheduledExportResult> {
  if (!isAccountingConfigured()) {
    return {
      ok: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: true,
    };
  }

  await reapStuckOutboxEvents().catch(() => 0);

  const settings = await getExportSettings();
  if (
    !isScheduledExportDue(
      settings.schedule,
      settings.last_automatic_export_at,
    )
  ) {
    return {
      ok: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: true,
      notDue: true,
      schedule: settings.schedule,
    };
  }

  const result = await drainOutbox(limit);
  await markAutomaticExportRun();
  return { ...result, schedule: settings.schedule };
}

// --- ledger_entity_map -----------------------------------------------------

function entityMapFromRow(row: SyncLogRow): LedgerEntityMap {
  return {
    id: stringOrNull(row.id) ?? "",
    connector: (connectorOrNull(row.connector) ?? "tiller") as ConnectorName,
    entity_type: (LEDGER_ENTITY_TYPES.includes(row.entity_type as LedgerEntityType)
      ? row.entity_type
      : "payment") as LedgerEntityType,
    internal_id: stringOrNull(row.internal_id) ?? "",
    external_id: stringOrNull(row.external_id) ?? "",
    created_at: stringOrNull(row.created_at) ?? "",
  };
}

export async function upsertEntityMap(
  connector: ConnectorName,
  entityType: LedgerEntityType,
  internalId: string,
  externalId: string,
): Promise<LedgerEntityMap | null> {
  const supabase = getServiceClient("upsertEntityMap");
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("ledger_entity_map")
    .upsert(
      {
        connector,
        entity_type: entityType,
        internal_id: internalId.slice(0, MAX_KEY_LENGTH),
        external_id: externalId.slice(0, MAX_EXTERNAL_ID_LENGTH),
      },
      { onConflict: "connector,entity_type,internal_id" },
    )
    .select("*")
    .maybeSingle();

  if (error) {
    warn("upsertEntityMap", error);
    return null;
  }
  return data ? entityMapFromRow(data as SyncLogRow) : null;
}
