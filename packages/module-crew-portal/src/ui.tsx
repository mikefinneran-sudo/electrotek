"use client";

// Staff crew portal dashboard. A single client component with four tabs over the
// aggregated service vertical: Dashboard (MRR/pipeline/recent activity), Leads
// (status filter + status update), Pipeline (inspections grouped by status), and
// Client detail (one account's inspection + contract + checklist + visits +
// metrics + timeline).
//
// UX mirrors always-be-cleaning's multiplexed crew.html / /api/crew (a tab
// switcher over one operational surface). Initial dashboard data is
// server-rendered by createCrewPage (service-role reads, behind the staff gate)
// and passed in as props; the Leads/Pipeline/Client tabs fetch on demand and all
// mutations go through the gated /api/crew endpoint.
//
// Reuses the shared globals.css classes (page, container, panel, tabs, tab,
// order-list, order-row, badge, btn, field, input, callout, empty, price-note,
// detail-dl, form-msg) so it matches the rest of the deploy stack.

import { useCallback, useEffect, useReducer, useState } from "react";
import { runGuardedLoad } from "@waltersignal/bananaforce-core";
import type {
  ClientDetail,
  CrewDashboardData,
  CrewPipelineGroup,
  Inspection,
  InspectionStatus,
  Lead,
  LeadStatus,
} from "./types";
import { LEAD_STATUSES } from "./types";
import { LeadDetails } from "@waltersignal/bananaforce-module-lead-capture/ui";
import {
  clientDetailReducer,
  initialClientDetailState,
  initialLeadsListState,
  leadsListReducer,
  resolveApiResult,
} from "./crew-load";

const ENDPOINT = "/api/crew";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "leads", label: "Leads" },
  { id: "pipeline", label: "Pipeline" },
  { id: "client", label: "Client detail" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const INSPECTION_STATUS_OPTIONS: readonly { value: InspectionStatus; label: string }[] = [
  { value: "drafting", label: "Drafting" },
  { value: "ready_to_send", label: "Ready to send" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
];

const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  walkthrough_scheduled: "Walkthrough scheduled",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

function formatUsd(value: number | null | undefined, fallback = "—"): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function inspectionLabel(inspection: Inspection): string {
  return (
    inspection.prospect_company ||
    inspection.prospect_name ||
    inspection.inspection_slug ||
    inspection.id.slice(0, 8)
  );
}

type ApiResult = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

async function getJson(url: string): Promise<ApiResult> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const result = (await response.json().catch(() => ({}))) as ApiResult;
    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error ?? "Request failed." };
    }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Request failed." };
  }
}

async function patchJson(payload: Record<string, unknown>): Promise<ApiResult> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => ({}))) as ApiResult;
    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error ?? "Request failed." };
    }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Request failed." };
  }
}

function useFlash() {
  const [flash, setFlash] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const show = useCallback((kind: "success" | "error", text: string) => {
    setFlash({ kind, text });
  }, []);
  return { flash, show };
}

function Flash({ flash }: { flash: { kind: "success" | "error"; text: string } | null }) {
  if (!flash) return null;
  return (
    <p className={`form-msg ${flash.kind === "error" ? "error" : "success"}`} role="status">
      {flash.text}
    </p>
  );
}

function leadStatusBadge(status: string): string {
  switch (status) {
    case "won":
      return "badge in-stock";
    case "lost":
      return "badge out-stock";
    case "new":
      return "badge low-stock";
    default:
      return "badge";
  }
}

function inspectionStatusBadge(status: InspectionStatus): string {
  switch (status) {
    case "accepted":
      return "badge in-stock";
    case "declined":
      return "badge out-stock";
    case "sent":
    case "ready_to_send":
      return "badge low-stock";
    default:
      return "badge";
  }
}

// --- Dashboard tab -------------------------------------------------------

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 10rem", textAlign: "center" }}>
      <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{value}</div>
      <div className="price-note" style={{ marginLeft: 0 }}>
        {label}
      </div>
    </div>
  );
}

function DashboardTab({
  data,
  onOpenClient,
}: {
  data: CrewDashboardData;
  onOpenClient: (id: string) => void;
}) {
  return (
    <div className="form">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
        <StatCard label="Monthly recurring revenue" value={formatUsd(data.mrr)} />
        <StatCard label="Open pipeline value" value={formatUsd(data.pipelineValue)} />
        <StatCard label="Active clients" value={String(data.activeClientCount)} />
        <StatCard label="New leads" value={String(data.newLeadCount)} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
        <div style={{ flex: "1 1 20rem" }}>
          <h2>Recent leads</h2>
          {data.recentLeads.length === 0 ? (
            <p className="price-note" style={{ marginLeft: 0 }}>
              No leads yet.
            </p>
          ) : (
            <div className="order-list">
              {data.recentLeads.map((lead) => (
                <div key={lead.id} className="order-row">
                  <div>
                    <strong>{lead.company || lead.name || "Lead"}</strong>
                    <div className="price-note" style={{ marginLeft: 0 }}>
                      {lead.email ?? ""} · {formatDate(lead.submitted_at)}
                    </div>
                  </div>
                  <span className={leadStatusBadge(lead.status)}>{lead.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: "1 1 20rem" }}>
          <h2>Recent inspections</h2>
          {data.recentInspections.length === 0 ? (
            <p className="price-note" style={{ marginLeft: 0 }}>
              No inspections yet.
            </p>
          ) : (
            <div className="order-list">
              {data.recentInspections.map((inspection) => (
                <button
                  key={inspection.id}
                  type="button"
                  className="order-row"
                  style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                  onClick={() => onOpenClient(inspection.id)}
                >
                  <div>
                    <strong>{inspectionLabel(inspection)}</strong>
                    <div className="price-note" style={{ marginLeft: 0 }}>
                      {formatDate(inspection.walkthrough_date)}
                    </div>
                  </div>
                  <span className={inspectionStatusBadge(inspection.status)}>
                    {inspection.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Leads tab -----------------------------------------------------------

function LeadsTab() {
  const [{ leads, loading }, dispatch] = useReducer(leadsListReducer<Lead>, initialLeadsListState<Lead>());
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "">("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const { flash, show } = useFlash();

  // Guarded with runGuardedLoad (WAL-594): switching the status filter
  // quickly starts a new fetch before the previous one resolves, and
  // without the guard a stale response could land last and overwrite the
  // list with leads for a filter the user has already left. leads/loading
  // collapsed into one reducer (WAL-593) so dispatch only ever fires from
  // inside runGuardedLoad's callbacks, never synchronously in the effect.
  useEffect(() => {
    dispatch({ type: "load-start" });
    const url = statusFilter
      ? `${ENDPOINT}?view=leads&status=${statusFilter}`
      : `${ENDPOINT}?view=leads`;
    return runGuardedLoad(
      () => getJson(url),
      (result) => {
        const resolved = resolveApiResult<Lead[]>(result, "leads", [], "Could not load leads.");
        if (!resolved.ok) {
          dispatch({ type: "load-done" });
          show("error", resolved.message);
          return;
        }
        dispatch({ type: "load-success", leads: resolved.value });
      },
      (message) => {
        dispatch({ type: "load-done" });
        show("error", message);
      },
      "Could not load leads.",
    );
  }, [statusFilter, show]);

  async function changeStatus(lead: Lead, status: LeadStatus) {
    setSavingId(lead.id);
    const result = await patchJson({ entity: "lead", id: lead.id, status });
    setSavingId(null);
    if (!result.ok) {
      show("error", result.error ?? "Could not update the lead.");
      return;
    }
    const updated = result.lead as Lead | undefined;
    if (updated) {
      dispatch({ type: "lead-updated", lead: updated });
    }
    show("success", "Lead updated.");
  }

  return (
    <div className="form">
      <Flash flash={flash} />
      <label className="field" style={{ maxWidth: "16rem" }}>
        <span>Filter by status</span>
        <select
          className="input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.currentTarget.value as LeadStatus | "")}
        >
          <option value="">All</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      {loading ? (
        <p className="price-note" style={{ marginLeft: 0 }}>
          Loading…
        </p>
      ) : leads.length === 0 ? (
        <div className="empty">
          <h2>No leads</h2>
          <p>Website leads appear here as they come in.</p>
        </div>
      ) : (
        <div className="order-list">
          {leads.map((lead) => (
            <div key={lead.id} className="order-row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
              <div style={{ flex: "2 1 16rem" }}>
                <strong>{lead.company || lead.name || "Lead"}</strong>
                <div className="price-note" style={{ marginLeft: 0 }}>
                  {lead.email ?? "—"} · {lead.phone ?? "—"} · {formatDate(lead.submitted_at)}
                </div>
                <LeadDetails metadata={lead.metadata} />
              </div>
              <label className="field" style={{ flex: "1 1 12rem" }}>
                <span className={leadStatusBadge(lead.status)}>{lead.status}</span>
                <select
                  className="input"
                  defaultValue=""
                  disabled={savingId === lead.id}
                  onChange={(e) => {
                    const value = e.currentTarget.value as LeadStatus;
                    if (value) void changeStatus(lead, value);
                    e.currentTarget.value = "";
                  }}
                >
                  <option value="">Change status…</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Pipeline tab --------------------------------------------------------

function PipelineTab({ onOpenClient }: { onOpenClient: (id: string) => void }) {
  const [groups, setGroups] = useState<CrewPipelineGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const { flash, show } = useFlash();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getJson(`${ENDPOINT}?view=pipeline`);
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        show("error", result.error ?? "Could not load the pipeline.");
        return;
      }
      setGroups((result.pipeline as CrewPipelineGroup[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [show]);

  if (loading) {
    return (
      <p className="price-note" style={{ marginLeft: 0 }}>
        Loading…
      </p>
    );
  }

  return (
    <div className="form">
      <Flash flash={flash} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-start" }}>
        {groups.map((group) => (
          <div key={group.status} className="panel" style={{ flex: "1 1 14rem", minWidth: "12rem" }}>
            <h2 style={{ display: "flex", justifyContent: "space-between" }}>
              <span className={inspectionStatusBadge(group.status)}>{group.status}</span>
              <span>{group.inspections.length}</span>
            </h2>
            {group.inspections.length === 0 ? (
              <p className="price-note" style={{ marginLeft: 0 }}>
                Empty
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {group.inspections.map((inspection) => (
                  <button
                    key={inspection.id}
                    type="button"
                    className="btn ghost"
                    style={{ textAlign: "left" }}
                    onClick={() => onOpenClient(inspection.id)}
                  >
                    {inspectionLabel(inspection)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Client detail tab ---------------------------------------------------

function ClientDetailTab({
  inspectionId,
  onClear,
}: {
  inspectionId: string | null;
  onClear: () => void;
}) {
  const [{ detail, loading }, dispatch] = useReducer(
    clientDetailReducer<ClientDetail>,
    initialClientDetailState<ClientDetail>(),
  );
  const [savingStatus, setSavingStatus] = useState(false);
  const { flash, show } = useFlash();

  // Guarded with runGuardedLoad (WAL-594): clicking between clients quickly
  // re-fires this effect before the previous fetch resolves, and without
  // the guard a stale response could land last and overwrite the detail
  // panel with data for a client the user already left.
  //
  // The `!inspectionId` branch used to call `setDetail(null)` here, but
  // when inspectionId is null the component always renders the "No client
  // selected" empty state below (see the early return right after this
  // effect) — `detail` is never read on that path, so that write was dead.
  // detail/loading collapsed into a reducer (WAL-593) so dispatch only
  // fires from inside runGuardedLoad's callbacks (or, for load-start,
  // synchronously — dispatch from useReducer isn't a useState setter, so
  // react-hooks/set-state-in-effect doesn't flag it there).
  useEffect(() => {
    if (!inspectionId) {
      return;
    }
    dispatch({ type: "load-start" });
    return runGuardedLoad(
      () => getJson(`${ENDPOINT}?view=client&id=${encodeURIComponent(inspectionId)}`),
      (result) => {
        const resolved = resolveApiResult<ClientDetail | null>(
          result,
          "detail",
          null,
          "Could not load the client.",
        );
        if (!resolved.ok) {
          show("error", resolved.message);
          dispatch({ type: "load-error" });
          return;
        }
        dispatch({ type: "load-success", detail: resolved.value });
      },
      (message) => {
        show("error", message);
        dispatch({ type: "load-error" });
      },
      "Could not load the client.",
    );
  }, [inspectionId, show]);

  async function changeStatus(status: InspectionStatus) {
    if (!detail) return;
    setSavingStatus(true);
    const result = await patchJson({
      entity: "inspection",
      id: detail.inspection.id,
      status,
    });
    setSavingStatus(false);
    if (!result.ok) {
      show("error", result.error ?? "Could not update the inspection.");
      return;
    }
    const updated = result.inspection as Inspection | undefined;
    if (updated) dispatch({ type: "load-success", detail: { ...detail, inspection: updated } });
    show("success", "Inspection updated.");
  }

  if (!inspectionId) {
    return (
      <div className="empty">
        <h2>No client selected</h2>
        <p>Open a client from the Dashboard or Pipeline tab to see the full account.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <p className="price-note" style={{ marginLeft: 0 }}>
        Loading…
      </p>
    );
  }

  if (!detail) {
    return (
      <div className="form">
        <Flash flash={flash} />
        <div className="callout">
          <strong>Not found.</strong> This client could not be loaded.
        </div>
        <button type="button" className="btn ghost" onClick={onClear}>
          Back
        </button>
      </div>
    );
  }

  const { inspection, lead, contract, checklist, visits, metrics, timeline } = detail;

  return (
    <div className="form">
      <Flash flash={flash} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{inspectionLabel(inspection)}</h2>
        <button type="button" className="btn ghost" onClick={onClear}>
          Back
        </button>
      </div>

      <dl className="detail-dl">
        <dt>Status</dt>
        <dd>
          <span className={inspectionStatusBadge(inspection.status)}>{inspection.status}</span>
        </dd>
        <dt>Monthly revenue</dt>
        <dd>{formatUsd(metrics.monthlyRevenue)}</dd>
        <dt>Projected annual</dt>
        <dd>{formatUsd(metrics.projectedAnnual)}</dd>
        <dt>Estimated LTV</dt>
        <dd>{formatUsd(metrics.estimatedLtv)}</dd>
        <dt>Months active</dt>
        <dd>{metrics.monthsActive ?? "—"}</dd>
        <dt>Account since</dt>
        <dd>{formatDate(metrics.accountSince)}</dd>
        <dt>Visits</dt>
        <dd>
          {metrics.completedVisitCount}/{metrics.visitCount} complete
        </dd>
        <dt>Contract</dt>
        <dd>{contract ? contract.status : "None"}</dd>
        <dt>Checklist</dt>
        <dd>{checklist ? `${checklist.items.length} items (${checklist.checklist.status})` : "None"}</dd>
        <dt>Lead source</dt>
        <dd>{lead?.source ?? "—"}</dd>
      </dl>

      <label className="field" style={{ maxWidth: "16rem" }}>
        <span>Advance status</span>
        <select
          className="input"
          value={inspection.status}
          disabled={savingStatus}
          onChange={(e) => void changeStatus(e.currentTarget.value as InspectionStatus)}
        >
          {INSPECTION_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <h2>Timeline</h2>
      {timeline.length === 0 ? (
        <p className="price-note" style={{ marginLeft: 0 }}>
          No events yet.
        </p>
      ) : (
        <div className="order-list">
          {timeline.map((event, i) => (
            <div key={`${event.label}-${i}`} className="order-row">
              <div>
                <strong>{event.label}</strong>
                <div className="price-note" style={{ marginLeft: 0 }}>
                  {event.detail}
                </div>
              </div>
              <span className="price-note" style={{ marginLeft: 0 }}>
                {formatDate(event.date)}
              </span>
            </div>
          ))}
        </div>
      )}

      <h2>Visits</h2>
      {visits.length === 0 ? (
        <p className="price-note" style={{ marginLeft: 0 }}>
          No visits logged.
        </p>
      ) : (
        <div className="order-list">
          {visits.map((visit) => (
            <div key={visit.id} className="order-row">
              <div>
                <strong>{formatDate(visit.visit_date)}</strong>
                <div className="price-note" style={{ marginLeft: 0 }}>
                  {visit.tasks_done ?? "?"}/{visit.tasks_total ?? "?"} tasks
                  {visit.signed_by ? ` · ${visit.signed_by}` : ""}
                </div>
              </div>
              <span className="badge">{visit.status ?? "logged"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- shell ---------------------------------------------------------------

export interface CrewDashboardProps {
  title?: string;
  setupRequired?: boolean;
  notAuthorized?: boolean;
  dashboard: CrewDashboardData;
}

/**
 * The staff crew portal dashboard. Renders the tab switcher and the active tab.
 * Dashboard data is server-rendered (behind the staff gate); the other tabs
 * fetch on demand and all mutations route through the gated /api/crew endpoint.
 */
export function CrewDashboard({
  title = "Crew portal",
  setupRequired = false,
  notAuthorized = false,
  dashboard,
}: CrewDashboardProps) {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [clientId, setClientId] = useState<string | null>(null);

  const openClient = useCallback((id: string) => {
    setClientId(id);
    setTab("client");
  }, []);

  if (notAuthorized) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Crew portal</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Not authorized.</strong> You do not have access to the crew portal.
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
            <span className="eyebrow">Crew portal</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Setup required.</strong> The crew portal is not yet configured for this site.
            Contact your administrator.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="container">
        <header className="page-head">
          <span className="eyebrow">Crew portal</span>
          <h1>{title}</h1>
          <p className="lede">Pipeline, leads, and the full picture on every account.</p>
        </header>

        <div className="tabs" role="tablist" style={{ marginBottom: "1.5rem", flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "dashboard" ? (
          <DashboardTab data={dashboard} onOpenClient={openClient} />
        ) : null}
        {tab === "leads" ? <LeadsTab /> : null}
        {tab === "pipeline" ? <PipelineTab onOpenClient={openClient} /> : null}
        {tab === "client" ? (
          <ClientDetailTab inspectionId={clientId} onClear={() => setClientId(null)} />
        ) : null}
      </section>
    </div>
  );
}
