"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  fetchStateReducer,
  initialFetchState,
} from "@waltersignal/bananaforce-core";
import type {
  CaseClaimant,
  CaseEvidence,
  CaseParticipant,
  CaseTimeEntry,
  Deposition,
} from "./types";

export interface CaseFileViewProps {
  /** The forensic-case API. */
  endpoint?: string;
  /** The CRM API, which owns public.cases (and public.accounts). */
  casesEndpoint?: string;
  title?: string;
  setupRequired?: boolean;
}

/** The case as module-crm returns it; only the fields a case file needs. */
interface CaseRow {
  id: string;
  case_number: string;
  title: string | null;
  status: string;
  case_type: string | null;
  incident_date: string | null;
  incident_location: string | null;
  opened_on: string | null;
  closed_on: string | null;
  notes: string | null;
  legacy_id: string | null;
}

interface AccountRow {
  id: string;
  name: string;
  industry: string | null;
  domain: string | null;
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
}

/**
 * The workspace has one destination, not two. A case file IS the CRM here:
 * accounts are the carriers and law firms, contacts are the people at them, and
 * both exist to be reached from a case. Splitting them across /cases and /crm
 * made the same records look like two systems.
 */
type Workspace = "cases" | "accounts" | "contacts";

const WORKSPACE_LABELS: Record<Workspace, string> = {
  cases: "Case files",
  accounts: "Accounts",
  contacts: "Contacts",
};

const WORKSPACES: readonly Workspace[] = ["cases", "accounts", "contacts"];

type Section = "evidence" | "claimants" | "participants" | "depositions" | "time_entries";

const SECTION_LABELS: Record<Section, string> = {
  evidence: "Evidence",
  claimants: "Claimants",
  participants: "Parties",
  depositions: "Depositions",
  time_entries: "Time",
};

const SECTIONS: readonly Section[] = [
  "evidence",
  "claimants",
  "participants",
  "depositions",
  "time_entries",
];

const PAGE_LIMIT = 50;
const CHILD_LIMIT = 200;

interface CaseFile {
  evidence: CaseEvidence[];
  claimants: CaseClaimant[];
  participants: CaseParticipant[];
  depositions: Deposition[];
  time_entries: CaseTimeEntry[];
}

const EMPTY_FILE: CaseFile = {
  evidence: [],
  claimants: [],
  participants: [],
  depositions: [],
  time_entries: [],
};

/** An absent value reads as a dash, never as a crash or an empty cell. */
function text(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? "—" : trimmed;
}

function money(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toFixed(2)}`;
}

/** A number field with no currency or precision rule of its own (multiplier). */
function num(value: number | null): string {
  return value === null ? "—" : String(value);
}

function hours(value: number): string {
  // Migrated hours carry four decimals because FileMaker recorded 2.666. Show
  // what is stored, trimmed, rather than rounding it again on the way out.
  return String(Number(value)).replace(/\.?0+$/, "") || "0";
}

function statusBadgeClass(status: string): string {
  if (status === "open") return "case-open";
  if (status === "on_hold") return "case-hold";
  return "case-closed";
}

function statusLabel(status: string): string {
  return status === "on_hold" ? "On hold" : status.charAt(0).toUpperCase() + status.slice(1);
}

/** The case row's meta line: whichever of case type and incident date are
 *  actually present, never a blank dash for a field that carries no data. */
function caseRowMeta(row: CaseRow): string[] {
  return [row.case_type, row.incident_date].filter(
    (value): value is string => (value ?? "").trim() !== "",
  );
}

/**
 * Accounts and contacts did not migrate from FileMaker — the practice's
 * Companies, LawFirms, Attorneys, Experts and Clients tables (4,343 records
 * between them) have no destination here yet. An empty table with no
 * explanation reads as broken software; this says what is actually true.
 */
function partyEmptyMessage(workspace: "accounts" | "contacts", activeSearch: string): string {
  const noun = workspace === "accounts" ? "accounts" : "contacts";
  if (activeSearch !== "") return `No ${noun} match "${activeSearch}".`;
  return `Account and contact records have not migrated from FileMaker yet.`;
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  const body = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || body.ok === false) {
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  }
  return body;
}

function query(endpoint: string, params: Record<string, string | number | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== "") search.set(key, String(value));
  }
  return `${endpoint}?${search.toString()}`;
}

/**
 * The case file workspace.
 *
 * A forensic practice does not work a pipeline; it works a case. This view is
 * therefore a list of cases and, for the selected one, everything attached to
 * it: the evidence in the store, the claimants, the experts and attorneys, the
 * depositions and the time billed. Those five live in module-forensic-case and
 * the case header lives in module-crm, which is why this reads two endpoints.
 *
 * The five sections render open, stacked, all at once — never behind a tab.
 * Staff gave up a FileMaker layout that showed forty fields on one screen;
 * five buttons hiding five fields each is not a replacement for that, it is a
 * downgrade with extra clicks. The section buttons here are a quick-jump, not
 * a gate.
 */
export function CaseFileView({
  endpoint = "/api/forensic-case",
  casesEndpoint = "/api/crm-records",
  title = "Case files",
  setupRequired = false,
}: CaseFileViewProps) {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [file, setFile] = useState<CaseFile>(EMPTY_FILE);
  const [activeSection, setActiveSection] = useState<Section>("evidence");
  const [workspace, setWorkspace] = useState<Workspace>("cases");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [partyCursor, setPartyCursor] = useState<string | null>(null);
  const [listLoad, dispatchListLoad] = useReducer(
    fetchStateReducer<null>,
    initialFetchState<null>(),
  );
  const [fileLoad, dispatchFileLoad] = useReducer(
    fetchStateReducer<null>,
    initialFetchState<null>(),
  );
  const [error, setError] = useState<string | null>(null);
  const listLoading = listLoad.status === "loading";
  const fileLoading = fileLoad.status === "loading";

  const listRef = useRef<AbortController | null>(null);
  const fileRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const loadCases = useCallback(
    async (options: { append?: boolean; cursor?: string | null } = {}) => {
      listRef.current?.abort();
      const controller = new AbortController();
      listRef.current = controller;
      dispatchListLoad({ type: "load-start" });
      try {
        const data = await fetchJson<{ cases?: CaseRow[]; nextCursor?: string | null }>(
          query(casesEndpoint, {
            entity: "cases",
            limit: PAGE_LIMIT,
            cursor: options.cursor ?? null,
            search: debounced,
          }),
          controller.signal,
        );
        const rows = data.cases ?? [];
        setCases((current) => (options.append ? [...current, ...rows] : rows));
        setCursor(data.nextCursor ?? null);
        setError(null);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError((cause as Error).message);
      } finally {
        if (listRef.current === controller) {
          listRef.current = null;
          dispatchListLoad({ type: "reset" });
        }
      }
    },
    [casesEndpoint, debounced],
  );

  const loadFile = useCallback(
    async (caseId: string) => {
      fileRef.current?.abort();
      const controller = new AbortController();
      fileRef.current = controller;
      dispatchFileLoad({ type: "load-start" });
      try {
        // One request per section, in parallel. The alternative is a joined
        // endpoint that has to change every time a section does.
        const [evidence, claimants, participants, depositions, time] = await Promise.all(
          SECTIONS.map((name) =>
            fetchJson<{ records?: unknown[] }>(
              query(endpoint, { entity: name, caseId, limit: CHILD_LIMIT }),
              controller.signal,
            ),
          ),
        );
        setFile({
          evidence: (evidence.records ?? []) as CaseEvidence[],
          claimants: (claimants.records ?? []) as CaseClaimant[],
          participants: (participants.records ?? []) as CaseParticipant[],
          depositions: (depositions.records ?? []) as Deposition[],
          time_entries: (time.records ?? []) as CaseTimeEntry[],
        });
        setError(null);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError((cause as Error).message);
      } finally {
        if (fileRef.current === controller) {
          fileRef.current = null;
          dispatchFileLoad({ type: "reset" });
        }
      }
    },
    [endpoint],
  );

  const loadParties = useCallback(
    async (
      entity: "accounts" | "contacts",
      options: { append?: boolean; cursor?: string | null } = {},
    ) => {
      listRef.current?.abort();
      const controller = new AbortController();
      listRef.current = controller;
      dispatchListLoad({ type: "load-start" });
      try {
        const data = await fetchJson<{
          accounts?: AccountRow[];
          contacts?: ContactRow[];
          nextCursor?: string | null;
        }>(
          query(casesEndpoint, {
            entity,
            limit: PAGE_LIMIT,
            cursor: options.cursor ?? null,
            search: debounced,
          }),
          controller.signal,
        );
        if (entity === "accounts") {
          const rows = data.accounts ?? [];
          setAccounts((current) => (options.append ? [...current, ...rows] : rows));
        } else {
          const rows = data.contacts ?? [];
          setContacts((current) => (options.append ? [...current, ...rows] : rows));
        }
        setPartyCursor(data.nextCursor ?? null);
        setError(null);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError((cause as Error).message);
      } finally {
        if (listRef.current === controller) {
          listRef.current = null;
          dispatchListLoad({ type: "reset" });
        }
      }
    },
    [casesEndpoint, debounced],
  );

  useEffect(() => {
    if (setupRequired) return;
    // Async wrapper per the WAL-593 convention (module-crm): the loaders set
    // state only after their first await; stale responses are cancelled by
    // the AbortController refs, not here.
    void (async () => {
      if (workspace === "cases") await loadCases();
      else await loadParties(workspace);
    })();
  }, [loadCases, loadParties, setupRequired, workspace]);

  // The screen never opens on an empty pane. Once the list loads, the first
  // case is open; if the selection scrolls out of the loaded page (a new
  // search, for instance) the next available case takes its place. Adjusted
  // during render rather than in an effect, so there is no extra render pass.
  if (
    !setupRequired &&
    workspace === "cases" &&
    !(selectedId !== null && cases.some((row) => row.id === selectedId))
  ) {
    const next = cases.length > 0 ? cases[0].id : null;
    if (next !== selectedId) setSelectedId(next);
  }

  useEffect(() => {
    if (setupRequired || selectedId === null) return;
    void (async () => {
      await loadFile(selectedId);
    })();
  }, [loadFile, selectedId, setupRequired]);

  useEffect(() => () => {
    listRef.current?.abort();
    fileRef.current?.abort();
  }, []);

  const selected = useMemo(
    () => cases.find((row) => row.id === selectedId) ?? null,
    [cases, selectedId],
  );

  const billed = useMemo(
    () => file.time_entries.reduce((total, entry) => total + Number(entry.hours), 0),
    [file.time_entries],
  );

  const counts = useMemo<Record<Section, number>>(
    () => ({
      evidence: file.evidence.length,
      claimants: file.claimants.length,
      participants: file.participants.length,
      depositions: file.depositions.length,
      time_entries: file.time_entries.length,
    }),
    [file],
  );

  const jumpToSection = useCallback((name: Section) => {
    setActiveSection(name);
    document.getElementById(`case-section-${name}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  if (setupRequired) {
    return (
      <main className="container">
        <header className="page-head">
          <span className="eyebrow">Case files</span>
          <h1>{title}</h1>
        </header>
        <p>
          Supabase is not configured for this app, so no case can be read. Set the Supabase
          environment variables and reload.
        </p>
      </main>
    );
  }

  return (
    <main className="container">
      <header className="page-head">
        <span className="eyebrow">Case files</span>
        <h1>{title}</h1>
      </header>

      {error ? (
        <div className="error-panel" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <div className="tabs case-toolbar">
        {WORKSPACES.map((name) => (
          <button
            key={name}
            type="button"
            className={`tab ${workspace === name ? "active" : ""}`}
            onClick={() => {
              // A stale cursor from the workspace being left must never page the one
              // being entered, so clear it before the switch, not after the fetch.
              setPartyCursor(null);
              setWorkspace(name);
            }}
          >
            {WORKSPACE_LABELS[name]}
          </button>
        ))}
      </div>

      <div className="case-search-row">
        <input
          type="search"
          className="input"
          value={search}
          placeholder={
            workspace === "cases"
              ? "Search case number or title"
              : workspace === "accounts"
                ? "Search accounts"
                : "Search contacts"
          }
          onChange={(event) => setSearch(event.target.value)}
          aria-label={`Search ${WORKSPACE_LABELS[workspace].toLowerCase()}`}
        />
      </div>

      {workspace === "accounts" ? (
        <section>
          <Rows
            head={["Name", "Industry", "Domain"]}
            rows={accounts.map((row) => [text(row.name), text(row.industry), text(row.domain)])}
            empty={partyEmptyMessage("accounts", debounced)}
          />
          {partyCursor ? (
            <div className="list-actions">
              <button
                className="btn btn-secondary btn-sm"
                disabled={listLoading}
                onClick={() => void loadParties("accounts", { append: true, cursor: partyCursor })}
              >
                {listLoading ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </section>
      ) : workspace === "contacts" ? (
        <section>
          <Rows
            head={["Name", "Title", "Email", "Phone"]}
            rows={contacts.map((row) => [
              text([row.first_name, row.last_name].filter(Boolean).join(" ") || null),
              text(row.title),
              text(row.email),
              text(row.phone),
            ])}
            empty={partyEmptyMessage("contacts", debounced)}
          />
          {partyCursor ? (
            <div className="list-actions">
              <button
                className="btn btn-secondary btn-sm"
                disabled={listLoading}
                onClick={() => void loadParties("contacts", { append: true, cursor: partyCursor })}
              >
                {listLoading ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="case-shell">
          <section className="case-list-panel">
            <div className="case-list-scroll">
              {cases.length === 0 && !listLoading ? (
                <p className="case-empty-list">No cases match that search.</p>
              ) : (
                cases.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`case-row ${row.id === selectedId ? "active" : ""}`}
                    aria-selected={row.id === selectedId}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <div className="case-row-top">
                      <span className="case-row-number">{row.case_number}</span>
                      <span className={`badge ${statusBadgeClass(row.status)}`}>
                        {statusLabel(row.status)}
                      </span>
                    </div>
                    <div className="case-row-title">{text(row.title)}</div>
                    {caseRowMeta(row).length > 0 ? (
                      <div className="case-row-meta">
                        {caseRowMeta(row).map((value) => (
                          <span key={value}>{value}</span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))
              )}
            </div>
            {cursor ? (
              <div className="list-actions">
                <button
                  className="btn btn-secondary btn-sm block"
                  disabled={listLoading}
                  onClick={() => void loadCases({ append: true, cursor })}
                >
                  {listLoading ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </section>

          <section>
            {selected === null ? (
              <p className="case-empty-list">
                {listLoading ? "Loading cases…" : "No cases match that search."}
              </p>
            ) : (
              <>
                <div className="case-detail-head">
                  <div className="case-detail-heading">
                    <span className="case-detail-number">{selected.case_number}</span>
                    <span className={`badge ${statusBadgeClass(selected.status)}`}>
                      {statusLabel(selected.status)}
                    </span>
                  </div>
                  <h2 className="case-detail-title">{text(selected.title)}</h2>
                </div>

                <dl className="case-field-grid">
                  <Field label="Type" value={text(selected.case_type)} />
                  <Field label="Opened" value={text(selected.opened_on)} />
                  <Field label="Closed" value={text(selected.closed_on)} />
                  <Field label="Incident date" value={text(selected.incident_date)} />
                  <Field label="Incident location" value={text(selected.incident_location)} />
                  <Field label="Hours billed" value={hours(billed)} />
                  <Field label="Notes" value={text(selected.notes)} />
                  <Field label="FileMaker id" value={text(selected.legacy_id)} />
                </dl>

                <nav className="case-section-nav" aria-label="Jump to section">
                  {SECTIONS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={activeSection === name ? "active" : ""}
                      onClick={() => jumpToSection(name)}
                    >
                      {SECTION_LABELS[name]} ({counts[name]})
                    </button>
                  ))}
                </nav>

                {fileLoading ? <p>Loading case file…</p> : null}

                <div className="case-sections">
                  <div id="case-section-evidence" className="case-section panel-group">
                    <div className="panel-group-head">
                      <h2>Evidence ({counts.evidence})</h2>
                    </div>
                    <Rows
                      head={[
                        "Description",
                        "Pieces",
                        "Received",
                        "Report date",
                        "Action",
                        "Action date",
                        "Disposition date",
                        "Disposition method",
                        "Custodian",
                        "Storage location",
                        "Other location",
                        "Response",
                        "Results",
                        "Returned to",
                        "X-ray status",
                        "X-ray date",
                        "Work order ref.",
                      ]}
                      rows={file.evidence.map((row) => [
                        text(row.description),
                        text(row.piece_count),
                        text(row.received_on),
                        text(row.report_on),
                        text(row.action),
                        text(row.action_on),
                        text(row.disposition_on),
                        text(row.disposition_method),
                        text(row.custodian_initials),
                        text(row.storage_location),
                        text(row.other_location),
                        text(row.response),
                        text(row.results),
                        text(row.returned_to),
                        text(row.xray_status),
                        text(row.xray_on),
                        text(row.work_order_reference),
                      ])}
                      empty="No evidence recorded on this case."
                    />
                  </div>

                  <div id="case-section-claimants" className="case-section panel-group">
                    <div className="panel-group-head">
                      <h2>Claimants ({counts.claimants})</h2>
                    </div>
                    <Rows
                      head={[
                        "Display name",
                        "First name",
                        "Last name",
                        "Status",
                        "Address 1",
                        "Address 2",
                        "City",
                        "State",
                        "ZIP",
                        "Loss date",
                        "Email",
                        "Cell",
                        "Home",
                        "Work",
                        "Ext.",
                        "Instructions",
                      ]}
                      rows={file.claimants.map((row) => [
                        text(row.display_name),
                        text(row.first_name),
                        text(row.last_name),
                        text(row.status),
                        text(row.address_line_1),
                        text(row.address_line_2),
                        text(row.city),
                        text(row.state),
                        text(row.postal_code),
                        text(row.loss_date),
                        text(row.email),
                        text(row.cell_phone),
                        text(row.home_phone),
                        text(row.work_phone),
                        text(row.work_extension),
                        text(row.instructions),
                      ])}
                      empty="No claimants recorded on this case."
                    />
                  </div>

                  <div id="case-section-participants" className="case-section panel-group">
                    <div className="panel-group-head">
                      <h2>Parties ({counts.participants})</h2>
                    </div>
                    <Rows
                      head={["Type", "Role", "Notes", "Legacy contact ID", "Legacy account ID"]}
                      rows={file.participants.map((row) => [
                        text(row.participant_type),
                        text(row.role),
                        text(row.notes),
                        text(row.legacy_contact_ref),
                        text(row.legacy_account_ref),
                      ])}
                      empty="No experts or attorneys recorded on this case."
                    />
                  </div>

                  <div id="case-section-depositions" className="case-section panel-group">
                    <div className="panel-group-head">
                      <h2>Depositions ({counts.depositions})</h2>
                    </div>
                    <Rows
                      head={["Deponent", "Scheduled", "Description", "Summary", "Location"]}
                      rows={file.depositions.map((row) => [
                        text(row.deponent),
                        text(row.scheduled_on),
                        text(row.description),
                        text(row.display_text),
                        text(row.location),
                      ])}
                      empty="No depositions recorded on this case."
                    />
                  </div>

                  <div id="case-section-time_entries" className="case-section panel-group">
                    <div className="panel-group-head">
                      <h2>Time ({counts.time_entries})</h2>
                    </div>
                    <Rows
                      head={[
                        "Date",
                        "Category",
                        "Description",
                        "Hours",
                        "Rate",
                        "Multiplier",
                        "Location",
                        "Billed",
                        "Invoice",
                      ]}
                      rows={file.time_entries.map((row) => [
                        text(row.entry_date),
                        text(row.category),
                        text(row.description),
                        hours(row.hours),
                        money(row.hourly_rate),
                        num(row.multiplier),
                        text(row.location),
                        money(row.billed_amount),
                        text(row.invoice_number),
                      ])}
                      empty="No time billed to this case."
                    />
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="case-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Rows({
  head,
  rows,
  empty,
}: {
  head: readonly string[];
  rows: readonly (readonly string[])[];
  empty: string;
}) {
  if (rows.length === 0) return <p className="case-empty-list">{empty}</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {head.map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, index) => (
            <tr key={index}>
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
