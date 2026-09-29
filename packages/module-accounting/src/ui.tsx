"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { runGuardedLoad } from "@waltersignal/bananaforce-core";
import type {
  ConnectorName,
  DefaultAccountMapKey,
  ExportSchedule,
  ExportSettings,
  LedgerAccountMap,
  LedgerOutboxEvent,
  LedgerSyncLog,
} from "./types";
import { DEFAULT_ACCOUNT_MAP_KEYS, type LedgerEventType } from "./types";
import {
  EXPORT_SCHEDULE_OPTIONS,
} from "./export-schedule";
import {
  accountMapReducer,
  initialAccountMapState,
  initialPendingOutboxState,
  pendingOutboxReducer,
} from "./accounting-state";

// --- pure fetchers ---------------------------------------------------------
// Extracted to module scope (WAL-594) so the stale-response guard around
// each one can be exercised in tests without a React renderer — this repo
// has no React testing library. Each returns the parsed payload or throws;
// callers decide how to route the result (state on success, message on
// error), the same split `packages/module-ordering` uses for `reload`.

/** Exported for tests. */
export async function fetchAccountMap(
  endpoint: string,
  connector: ConnectorName,
): Promise<LedgerAccountMap[]> {
  const r = await fetch(`${endpoint}?resource=account-map&connector=${connector}`, {
    headers: { Accept: "application/json" },
  });
  const body = (await r.json()) as { ok?: boolean; rows?: LedgerAccountMap[]; error?: string };
  if (body.ok && Array.isArray(body.rows)) return body.rows;
  throw new Error(body.error ?? "Could not load account map.");
}

/** Exported for tests. */
export async function fetchSyncRuns(endpoint: string): Promise<LedgerSyncLog[]> {
  const body = (await fetch(`${endpoint}?resource=sync-runs`, {
    headers: { Accept: "application/json" },
  }).then((r) => r.json())) as { ok?: boolean; runs?: LedgerSyncLog[]; error?: string };
  if (body.ok && Array.isArray(body.runs)) return body.runs;
  throw new Error(body.error ?? "Could not load sync history.");
}

/** Exported for tests. */
export async function fetchFailedOutboxEvents(endpoint: string): Promise<LedgerOutboxEvent[]> {
  const body = (await fetch(`${endpoint}?resource=outbox&status=failed`, {
    headers: { Accept: "application/json" },
  }).then((r) => r.json())) as { ok?: boolean; events?: LedgerOutboxEvent[] };
  if (body.ok && Array.isArray(body.events)) return body.events;
  throw new Error("Could not load failed exports.");
}

export interface AccountingViewProps {
  title?: string;
  /** Which connectors are configured (booleans from the server; no env names). */
  connectorStatus?: { tiller: boolean; wave: boolean };
  notAuthorized?: boolean;
  setupRequired?: boolean;
  pendingOutbox?: number;
  failedOutbox?: number;
  exportSettings?: ExportSettings;
  endpoint?: string;
}

type TriggerState =
  | { status: "idle" }
  | { status: "running"; connector: string }
  | { status: "done"; connector: string; ok: boolean; skipped?: boolean; message: string };

type WaveBannerState = { kind: "success" | "error"; message: string } | null;

function ConnectorBadge({
  name,
  configured,
}: {
  name: string;
  configured: boolean;
}) {
  return (
    <span
      className={`badge ${configured ? "" : "low-stock"}`}
      title={configured ? "Connected" : "Not connected"}
    >
      {name}: {configured ? "connected" : "not connected"}
    </span>
  );
}

function humanEventType(eventType: LedgerEventType): string {
  switch (eventType) {
    case "payment.succeeded":
      return "Payment received";
    case "payment.refunded":
      return "Payment refunded";
    case "invoice.opened":
      return "Invoice sent";
    case "order.submitted":
      return "Order submitted";
    case "expense.recorded":
      return "Expense recorded";
    default: {
      const exhaustive: never = eventType;
      return exhaustive;
    }
  }
}

function humanSourceModule(moduleName: string): string {
  switch (moduleName) {
    case "billing":
      return "Billing";
    case "orders":
      return "Orders";
    case "admin":
      return "Admin";
    default:
      return moduleName;
  }
}

function ExportSchedulePanel({
  endpoint,
  initialSettings,
}: {
  endpoint: string;
  initialSettings: ExportSettings;
}) {
  const [schedule, setSchedule] = useState<ExportSchedule>(initialSettings.schedule);
  const [lastRun, setLastRun] = useState<string | null>(
    initialSettings.last_automatic_export_at,
  );
  const [saveState, setSaveState] = useState<
    { status: "idle" } | { status: "saving" } | { status: "done"; ok: boolean; message: string }
  >({ status: "idle" });

  async function saveSchedule(next: ExportSchedule) {
    setSchedule(next);
    setSaveState({ status: "saving" });
    try {
      const r = await fetch(`${endpoint}?action=save-export-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ schedule: next }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        settings?: ExportSettings;
        error?: string;
      };
      if (body.ok && body.settings) {
        setLastRun(body.settings.last_automatic_export_at);
      }
      setSaveState({
        status: "done",
        ok: body.ok ?? false,
        message: body.ok
          ? "Automatic export schedule saved."
          : body.error ?? "Could not save schedule.",
      });
    } catch {
      setSaveState({
        status: "done",
        ok: false,
        message: "Could not contact the server.",
      });
    }
  }

  return (
    <div className="panel pad" style={{ marginBottom: "1.5rem" }}>
      <span className="label" style={{ display: "block", marginBottom: "0.5rem" }}>
        Automatic export
      </span>
      <p className="price-note" style={{ marginBottom: "1rem" }}>
        Choose when payments and invoices are sent to Tiller or Wave. You can
        always use Export now for anything still waiting.
      </p>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
        {EXPORT_SCHEDULE_OPTIONS.map((option) => (
          <label
            key={option.value}
            style={{
              display: "flex",
              gap: "0.75rem",
              alignItems: "flex-start",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="export-schedule"
              value={option.value}
              checked={schedule === option.value}
              disabled={saveState.status === "saving"}
              onChange={() => void saveSchedule(option.value)}
              style={{ marginTop: "0.25rem" }}
            />
            <span>
              <strong style={{ display: "block" }}>{option.label}</strong>
              <span className="price-note">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {schedule === "daily" || schedule === "weekly" ? (
        <p className="price-note" style={{ marginTop: "0.75rem" }}>
          Scheduled exports run once per night on your hosting plan.
          {lastRun
            ? ` Last automatic batch: ${new Date(lastRun).toLocaleString()}.`
            : " No automatic batch has run yet."}
        </p>
      ) : null}
      {saveState.status === "done" ? (
        <p
          role="status"
          className={`form-msg ${saveState.ok ? "success" : "error"}`}
          style={{ marginTop: "0.75rem" }}
        >
          {saveState.message}
        </p>
      ) : saveState.status === "saving" ? (
        <p className="price-note" style={{ marginTop: "0.75rem" }}>
          Saving…
        </p>
      ) : null}
    </div>
  );
}

function FailedOutboxRow({
  event,
  endpoint,
  onRetried,
}: {
  event: LedgerOutboxEvent;
  endpoint: string;
  onRetried: () => void;
}) {
  const createdAt = new Date(event.created_at).toLocaleString();
  const [retryState, setRetryState] = useState<"idle" | "running" | "done">("idle");
  const [retryError, setRetryError] = useState<string | null>(null);

  async function retryExport() {
    setRetryState("running");
    setRetryError(null);
    try {
      const response = await fetch(`${endpoint}?action=retry-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: event.id }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Could not retry export.");
      }
      onRetried();
      setRetryState("done");
    } catch (error) {
      setRetryState("idle");
      setRetryError(error instanceof Error ? error.message : "Could not retry export.");
    }
  }

  return (
    <>
      <tr>
        <td>{humanEventType(event.event_type)}</td>
        <td>
          {humanSourceModule(event.source_module)}:{event.source_id}
        </td>
        <td>{createdAt}</td>
        <td>{event.attempts}</td>
        <td>
          {event.last_error ? (
            <span className="price-note" style={{ color: "var(--red, #b91c1c)" }}>
              {event.last_error}
            </span>
          ) : null}
        </td>
        <td>
          <button
            type="button"
            className="btn ghost"
            disabled={retryState === "running"}
            onClick={() => void retryExport()}
          >
            {retryState === "running" ? "Retrying…" : "Retry"}
          </button>
        </td>
      </tr>
      {retryError ? (
        <tr>
          <td colSpan={6} style={{ padding: "0.25rem 0.75rem 0.75rem" }}>
            <span className="form-msg error">{retryError}</span>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PendingOutboxPanel({
  endpoint,
  refreshKey,
}: {
  endpoint: string;
  refreshKey: number;
}) {
  const [state, dispatch] = useReducer(pendingOutboxReducer, initialPendingOutboxState);
  const { events, loading, error: loadError } = state;

  useEffect(() => {
    // Hand-rolled `active` guard predates WAL-594's runGuardedLoad and is
    // deliberately kept as-is (WAL-593) — this fetch is inlined rather than
    // routed through a module-scope fetcher, so runGuardedLoad's `load()`
    // signature does not fit without also extracting that fetcher, which is
    // out of scope here. Only the synchronous dispatch shape changed.
    let active = true;
    dispatch({ type: "load-start" });

    fetch(`${endpoint}?resource=outbox&status=pending`, {
      headers: { Accept: "application/json" },
    })
      .then((r) => r.json())
      .then((body: { ok?: boolean; events?: LedgerOutboxEvent[]; error?: string }) => {
        if (!active) return;
        if (body.ok && Array.isArray(body.events)) {
          dispatch({ type: "load-success", events: body.events });
        } else {
          dispatch({ type: "load-error", message: body.error ?? "Could not load waiting exports." });
        }
      })
      .catch(() => {
        if (!active) return;
        dispatch({ type: "load-error", message: "Could not load waiting exports." });
      });

    return () => {
      active = false;
    };
  }, [endpoint, refreshKey]);

  return (
    <div className="panel pad" style={{ marginBottom: "1.5rem" }}>
      <span className="label" style={{ display: "block", marginBottom: "0.75rem" }}>
        Waiting to export
      </span>
      {loadError ? (
        <div className="callout">
          <strong>Could not load waiting exports.</strong> {loadError}
        </div>
      ) : loading ? (
        <p className="price-note">Loading waiting exports…</p>
      ) : events.length === 0 ? (
        <p className="price-note">No transactions are currently waiting to export.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Transaction</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Source</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Created</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Attempts</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td style={{ padding: "0.5rem 0.75rem" }}>{humanEventType(event.event_type)}</td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    {humanSourceModule(event.source_module)}:{event.source_id}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    {new Date(event.created_at).toLocaleString()}
                  </td>
                  <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>
                    {event.attempts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccountMapPanel({ endpoint }: { endpoint: string }) {
  const [connector, setConnector] = useState<ConnectorName>("tiller");
  const [mapState, dispatch] = useReducer(accountMapReducer, initialAccountMapState);
  const { rows, error: loadError } = mapState;
  const [saveState, setSaveState] = useState<
    { status: "idle" } | { status: "saving" } | { status: "done"; ok: boolean; message: string }
  >({ status: "idle" });
  const [form, setForm] = useState<{
    internal_key: DefaultAccountMapKey;
    external_id: string;
    label: string;
  }>({
    internal_key: DEFAULT_ACCOUNT_MAP_KEYS[0],
    external_id: "",
    label: "",
  });

  // `fetchAccountMap` does not set state itself, so both callers (the
  // auto-load effect below, guarded against stale connector switches, and
  // `saveMap`'s post-save refresh) decide how to route the result.
  const loadMap = useCallback(
    () => fetchAccountMap(endpoint, connector),
    [connector, endpoint],
  );

  useEffect(() => {
    dispatch({ type: "load-clear" });
    return runGuardedLoad(
      loadMap,
      (loadedRows) => dispatch({ type: "load-success", rows: loadedRows }),
      (message) => dispatch({ type: "load-error", message }),
      "Could not load account map.",
    );
  }, [loadMap]);

  function startEdit(row: LedgerAccountMap) {
    const key = DEFAULT_ACCOUNT_MAP_KEYS.includes(row.internal_key as DefaultAccountMapKey)
      ? (row.internal_key as DefaultAccountMapKey)
      : DEFAULT_ACCOUNT_MAP_KEYS[0];
    setForm({
      internal_key: key,
      external_id: row.external_id,
      label: row.label ?? "",
    });
  }

  async function saveMap(event: React.FormEvent) {
    event.preventDefault();
    if (!form.external_id.trim()) return;

    setSaveState({ status: "saving" });
    try {
      const r = await fetch(`${endpoint}?action=upsert-map`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          connector,
          internal_key: form.internal_key,
          external_id: form.external_id.trim(),
          label: form.label.trim() || null,
        }),
      });
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setSaveState({
        status: "done",
        ok: body.ok ?? false,
        message: body.ok ? "Account map saved." : body.error ?? "Could not save account map.",
      });
      if (body.ok) {
        try {
          dispatch({ type: "load-success", rows: await loadMap() });
        } catch (err) {
          dispatch({
            type: "load-error",
            message: err instanceof Error ? err.message : "Could not load account map.",
          });
        }
      }
    } catch {
      setSaveState({
        status: "done",
        ok: false,
        message: "Could not contact the server.",
      });
    }
  }

  const rowByKey = new Map(rows.map((row) => [row.internal_key, row]));

  return (
    <div className="panel pad" style={{ marginBottom: "1.5rem" }}>
      <span className="label" style={{ display: "block", marginBottom: "0.75rem" }}>
        Category mapping
      </span>
      <p className="price-note" style={{ marginBottom: "0.75rem" }}>
        Match each transaction type to a Tiller category or Wave account.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {(["tiller", "wave"] as const).map((name) => (
          <button
            key={name}
            type="button"
            className="btn ghost"
            aria-pressed={connector === name}
            onClick={() => setConnector(name)}
          >
            {name === "tiller" ? "Tiller" : "Wave"}
          </button>
        ))}
      </div>
      {loadError ? (
        <div className="callout">
          <strong>Could not load account map.</strong> Contact your administrator.
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Internal key</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>External id</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Label</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }} />
              </tr>
            </thead>
            <tbody>
              {DEFAULT_ACCOUNT_MAP_KEYS.map((key) => {
                const row = rowByKey.get(key);
                return (
                  <tr key={key}>
                    <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace" }}>{key}</td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      {row?.external_id ?? (
                        <span className="price-note">Not mapped</span>
                      )}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>{row?.label ?? "—"}</td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          startEdit(
                            row ?? {
                              id: "",
                              connector,
                              internal_key: key,
                              external_id: "",
                              label: null,
                              created_at: "",
                            },
                          )
                        }
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={(e) => void saveMap(e)} style={{ display: "grid", gap: "0.75rem" }}>
        <label className="field">
          <span className="label">Internal key</span>
          <select
            value={form.internal_key}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                internal_key: e.target.value as DefaultAccountMapKey,
              }))
            }
          >
            {DEFAULT_ACCOUNT_MAP_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">External id / category</span>
          <input
            type="text"
            value={form.external_id}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, external_id: e.target.value }))
            }
            required
          />
        </label>
        <label className="field">
          <span className="label">Label (optional)</span>
          <input
            type="text"
            value={form.label}
            onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
          />
        </label>
        <div>
          <button
            type="submit"
            className="btn ghost"
            disabled={saveState.status === "saving"}
          >
            {saveState.status === "saving" ? "Saving…" : "Save mapping"}
          </button>
        </div>
        {saveState.status === "done" ? (
          <p
            role="status"
            className={`form-msg ${saveState.ok ? "success" : "error"}`}
          >
            {saveState.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}

function SyncRunRow({ run }: { run: LedgerSyncLog }) {
  const startedAt = new Date(run.started_at).toLocaleString();
  const statusLabel =
    run.status === "succeeded"
      ? "Completed"
      : run.status === "skipped"
        ? "Skipped"
        : run.status === "failed"
          ? "Failed"
          : run.status === "running"
            ? "In progress"
            : run.status === "pending"
              ? "Waiting"
              : run.status;
  const connectorLabel =
    run.connector === "tiller"
      ? "Tiller"
      : run.connector === "wave"
        ? "Wave"
        : run.connector;

  return (
    <tr>
      <td>{connectorLabel}</td>
      <td>
        <span className={`badge ${run.status === "succeeded" ? "" : "low-stock"}`}>
          {statusLabel}
        </span>
      </td>
      <td>{startedAt}</td>
      <td>{run.records_synced}</td>
      <td>
        {run.error ? (
          <span className="price-note" style={{ color: "var(--red, #b91c1c)" }}>
            {run.error}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Staff-only accounting view. Shows connector status (configured/not) and
 * the ledger sync run history. Never surfaces env-var names in user-visible
 * text — uses the pre-computed connectorStatus booleans from the server.
 */
export function AccountingView({
  title = "Accounting",
  connectorStatus = { tiller: false, wave: false },
  notAuthorized = false,
  setupRequired = false,
  pendingOutbox = 0,
  failedOutbox = 0,
  exportSettings = {
    schedule: "when_recorded",
    last_automatic_export_at: null,
    updated_at: new Date(0).toISOString(),
  },
  endpoint = "/api/accounting",
}: AccountingViewProps) {
  const [runs, setRuns] = useState<LedgerSyncLog[]>([]);
  const [failedEvents, setFailedEvents] = useState<LedgerOutboxEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [triggerState, setTriggerState] = useState<TriggerState>({ status: "idle" });
  const [outboxRefreshKey, setOutboxRefreshKey] = useState(0);
  const [waveBanner, setWaveBanner] = useState<WaveBannerState>(null);

  // `fetchFailedOutboxEvents` does not set state itself — routed through
  // the effect below via `runGuardedLoad` so a stale response (e.g. from
  // before `exportNow()` bumped `outboxRefreshKey`) cannot overwrite a
  // newer one.
  const fetchFailedOutbox = useCallback(
    () => fetchFailedOutboxEvents(endpoint),
    [endpoint],
  );

  useEffect(() => {
    if (notAuthorized || setupRequired) return;

    // Two independently-erroring loads that always start and go stale
    // together (same deps, same effect) — one guard each, combined into a
    // single cleanup. They stay separate loads (not one combined fetch)
    // because their error handling differs: a failed sync-runs load
    // surfaces `loadError`, while a failed failed-outbox load silently
    // keeps the last snapshot, as it did before this guard existed.
    const cleanupRuns = runGuardedLoad(
      () => fetchSyncRuns(endpoint),
      (loadedRuns) => setRuns(loadedRuns),
      (message) => setLoadError(message),
      "Could not load sync history.",
    );

    const cleanupFailedOutbox = runGuardedLoad(
      fetchFailedOutbox,
      (events) => setFailedEvents(events),
      () => {
        // Keep the last failed-events snapshot if refresh fails.
      },
      "Could not load failed exports.",
    );

    return () => {
      cleanupRuns();
      cleanupFailedOutbox();
    };
  }, [notAuthorized, setupRequired, endpoint, fetchFailedOutbox, outboxRefreshKey]);

  useEffect(() => {
    const wave = new URLSearchParams(window.location.search).get("wave");
    if (wave === "connected") {
      // Reading `window.location.search` on mount is a one-time client-only
      // API read with no server equivalent — deliberately not a fetch, so
      // it does not fit the reducer/dispatch pattern used elsewhere in this
      // file. This is React's own documented exception to the rule. WAL-593.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWaveBanner({
        kind: "success",
        message: "Wave is now connected and ready for exports.",
      });
    } else if (wave === "error") {
      setWaveBanner({
        kind: "error",
        message: "Wave connection was cancelled or failed. Please try again.",
      });
    }
  }, []);

  async function exportNow() {
    setTriggerState({ status: "running", connector: "export" });
    try {
      const r = await fetch(`${endpoint}?action=export-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        processed?: number;
        succeeded?: number;
        failed?: number;
        skipped?: boolean;
      };
      const message = body.skipped
        ? "Export is not set up yet. Contact your administrator."
        : body.ok
          ? body.processed
            ? `Exported ${body.succeeded ?? 0} of ${body.processed} waiting transaction(s)${(body.failed ?? 0) > 0 ? ` (${body.failed} failed)` : ""}.`
            : "Nothing waiting to export."
          : "Export failed.";
      setTriggerState({
        status: "done",
        connector: "export",
        ok: body.ok ?? false,
        message,
      });
      const refreshed = await fetch(`${endpoint}?resource=sync-runs`, {
        headers: { Accept: "application/json" },
      }).then((res) => res.json());
      if (refreshed.ok && Array.isArray(refreshed.runs)) {
        setRuns(refreshed.runs);
      }
      setOutboxRefreshKey((prev) => prev + 1);
    } catch {
      setTriggerState({
        status: "done",
        connector: "export",
        ok: false,
        message: "Could not contact the server.",
      });
    }
  }

  async function connectWave() {
    setTriggerState({ status: "running", connector: "wave-oauth" });
    try {
      const r = await fetch(`${endpoint}?action=wave-oauth-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
      };
      if (body.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      setTriggerState({
        status: "done",
        connector: "wave-oauth",
        ok: false,
        message: "Could not start Wave connection.",
      });
    } catch {
      setTriggerState({
        status: "done",
        connector: "wave-oauth",
        ok: false,
        message: "Could not contact the server.",
      });
    }
  }

  if (notAuthorized) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Accounting</span>
            <h1>{title}</h1>
          </header>
          <div className="callout warn">
            <strong>Not authorized.</strong> You do not have access to accounting.
          </div>
        </section>
      </div>
    );
  }

  if (setupRequired) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Accounting</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Setup required.</strong> Accounting is not yet configured
            for this site. Contact your administrator.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="container">
        <header className="page-head">
          <span className="eyebrow">Accounting</span>
          <h1>{title}</h1>
        </header>

        {waveBanner ? (
          <div
            className={`callout ${waveBanner.kind === "error" ? "warn" : ""}`}
            style={{ marginBottom: "1rem" }}
          >
            <strong>{waveBanner.kind === "success" ? "Wave connected." : "Wave connection issue."}</strong>{" "}
            {waveBanner.message}
          </div>
        ) : null}

        {/* Connected apps */}
        <div className="panel pad" style={{ marginBottom: "1.5rem" }}>
          <span className="label" style={{ display: "block", marginBottom: "0.5rem" }}>
            Connected apps
          </span>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <ConnectorBadge name="Tiller" configured={connectorStatus.tiller} />
            <ConnectorBadge name="Wave" configured={connectorStatus.wave} />
            {pendingOutbox > 0 ? (
              <span className="badge low-stock">
                {pendingOutbox} waiting to export
              </span>
            ) : null}
            {failedOutbox > 0 ? (
              <span className="badge low-stock">
                {failedOutbox} export failed
              </span>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              marginTop: "1rem",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn primary"
              disabled={triggerState.status === "running"}
              onClick={() => void exportNow()}
            >
              {triggerState.status === "running" &&
              triggerState.connector === "export"
                ? "Exporting…"
                : "Export now"}
            </button>
            {!connectorStatus.wave ? (
              <button
                type="button"
                className="btn ghost"
                disabled={triggerState.status === "running"}
                onClick={() => void connectWave()}
              >
                Connect Wave
              </button>
            ) : null}
          </div>
          {triggerState.status === "done" ? (
            <p
              role="status"
              className={`form-msg ${triggerState.ok || triggerState.skipped ? "success" : "error"}`}
              style={{ marginTop: "0.5rem" }}
            >
              {triggerState.message}
            </p>
          ) : null}
        </div>

        <ExportSchedulePanel endpoint={endpoint} initialSettings={exportSettings} />

        <PendingOutboxPanel endpoint={endpoint} refreshKey={outboxRefreshKey} />

        <AccountMapPanel endpoint={endpoint} />

        {failedEvents.length > 0 ? (
          <div className="panel pad" style={{ marginBottom: "1.5rem" }}>
            <span className="label" style={{ display: "block", marginBottom: "0.75rem" }}>
              Exports that need attention
            </span>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Transaction</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Source</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Created</th>
                    <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Attempts</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Error</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {failedEvents.map((event) => (
                    <FailedOutboxRow
                      key={event.id}
                      event={event}
                      endpoint={endpoint}
                      onRetried={() => setOutboxRefreshKey((prev) => prev + 1)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* Export history */}
        <div className="panel pad">
          <span className="label" style={{ display: "block", marginBottom: "0.75rem" }}>
            Export history
          </span>
          {loadError ? (
            <div className="callout">
              <strong>Could not load export history.</strong> Contact your
              administrator.
            </div>
          ) : runs.length === 0 ? (
            <p className="price-note">No exports recorded yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Connector</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Started</th>
                    <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Records</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <SyncRunRow key={run.id} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
