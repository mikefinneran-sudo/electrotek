"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  Account,
  Activity,
  ActivityType,
  Case,
  CaseStatus,
  Contact,
  CrmTask,
  Opportunity,
  OpportunityStatus,
  Pipeline,
  PipelineStage,
} from "./types";
import { ACTIVITY_TYPES, CASE_STATUSES, OPPORTUNITY_STATUSES } from "./types";
import { openVsClosed, pipelineByStage, weightedPipelineValue } from "./pipeline";
import { defaultStageDraft } from "./stage-drafts";
import type { StageDraft } from "./stage-drafts";

export interface CrmViewProps {
  endpoint?: string;
  title?: string;
  setupRequired?: boolean;
  /**
   * Which surfaces this client's staff actually work in, in the order they
   * appear. Defaults to all of them.
   *
   * The pipeline, opportunities and task surfaces describe a sales
   * organisation. A forensic engineering practice runs case files: the same
   * accounts, contacts and cases, with no deal to move through stages. Shipping
   * a pipeline board to a client who has no pipeline is not a harmless extra
   * tab, it is the first screen they see telling them the tool is for somebody
   * else's job.
   */
  surfaces?: readonly Tab[];
}

export type Tab = "pipeline" | "cases" | "accounts" | "contacts" | "tasks";

export const ALL_CRM_SURFACES: readonly Tab[] = [
  "pipeline",
  "cases",
  "accounts",
  "contacts",
  "tasks",
];

/** Surfaces for a client with no sales motion: case files and the parties on them. */
export const CASE_FILE_SURFACES: readonly Tab[] = ["cases", "accounts", "contacts"];

const TAB_LABELS: Record<Tab, string> = {
  pipeline: "Pipeline",
  cases: "Cases",
  accounts: "Accounts",
  contacts: "Contacts",
  tasks: "Tasks",
};
type TaskDueFilter = "overdue" | "today" | "upcoming" | "all";
type CrmEntity =
  | "accounts"
  | "cases"
  | "contacts"
  | "opportunities"
  | "activities"
  | "tasks"
  | "stages"
  | "pipelines"
  | "deal_contacts";

interface LoadOptions {
  append?: boolean;
  cursor?: string | null;
  search?: string;
}

interface TaskLoadOptions {
  append?: boolean;
  cursor?: string | null;
  due?: TaskDueFilter;
}

interface ApiEnvelope {
  ok?: boolean;
  error?: string;
  nextCursor?: string | null;
}

type AbortRef = { current: AbortController | null };

const PAGE_LIMIT = 50;
const BOARD_PAGE_LIMIT = 200;

const TASK_FILTERS: { value: TaskDueFilter; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All" },
];

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function contactLabel(c: Contact): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || c.id;
}

function localDateParam(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function buildEndpoint(endpoint: string, params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      query.set(key, String(value));
    }
  }
  return `${endpoint}?${query.toString()}`;
}

async function fetchJson<T extends ApiEnvelope>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed (${res.status}).`);
  }
  return data;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function beginAbortableLoad(ref: AbortRef): AbortController {
  ref.current?.abort();
  const controller = new AbortController();
  ref.current = controller;
  return controller;
}

function abortLoad(ref: AbortRef): void {
  ref.current?.abort();
  ref.current = null;
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }
  return deduped;
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function useDialogFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      const [first] = getFocusableElements(node);
      (first ?? node).focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(node);
      if (focusable.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !node.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      node.removeEventListener("keydown", onKeyDown);
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    };
  }, []);

  return ref;
}

const ACTIVITY_ICON: Record<ActivityType, string> = {
  call: "📞",
  email: "✉️",
  meeting: "🤝",
  note: "📝",
};

const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
};

/**
 * Staff CRM workspace. Reads accounts, contacts, stages, opportunities and tasks
 * from the /api/crm-records endpoint. Staff can manage records, inspect the
 * pipeline, track follow-up work, and archive CRM rows through the existing API.
 */
export function CrmView({
  endpoint = "/api/crm-records",
  title = "CRM",
  setupRequired = false,
  surfaces = ALL_CRM_SURFACES,
}: CrmViewProps) {
  // An empty list would render a workspace with no way into anything, so the
  // full set is the floor rather than the caller's mistake becoming a blank page.
  const shown = surfaces.length > 0 ? surfaces : ALL_CRM_SURFACES;
  const [tab, setTab] = useState<Tab>(shown[0]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [boardOpps, setBoardOpps] = useState<Opportunity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [accountCursor, setAccountCursor] = useState<string | null>(null);
  const [caseCursor, setCaseCursor] = useState<string | null>(null);
  const [contactCursor, setContactCursor] = useState<string | null>(null);
  const [oppCursor, setOppCursor] = useState<string | null>(null);
  const [taskCursor, setTaskCursor] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [caseSearch, setCaseSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [oppSearch, setOppSearch] = useState("");
  const [taskDue, setTaskDue] = useState<TaskDueFilter>("overdue");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [casesLoading, setCasesLoading] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [oppsLoading, setOppsLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [boardComplete, setBoardComplete] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOppForm, setShowOppForm] = useState(false);
  const [showAcctForm, setShowAcctForm] = useState(false);
  const [showCaseForm, setShowCaseForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null);
  const [selectedOppRecord, setSelectedOppRecord] = useState<Opportunity | null>(null);
  const [lostRequest, setLostRequest] = useState<Opportunity | null>(null);

  const debouncedAccountSearch = useDebouncedValue(accountSearch, 300);
  const debouncedCaseSearch = useDebouncedValue(caseSearch, 300);
  const debouncedContactSearch = useDebouncedValue(contactSearch, 300);
  const debouncedOppSearch = useDebouncedValue(oppSearch, 300);
  const mountedRef = useRef(true);
  const accountsLoadRef = useRef<AbortController | null>(null);
  const casesLoadRef = useRef<AbortController | null>(null);
  const contactsLoadRef = useRef<AbortController | null>(null);
  const opportunitiesLoadRef = useRef<AbortController | null>(null);
  const tasksLoadRef = useRef<AbortController | null>(null);
  const boardLoadRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortLoad(accountsLoadRef);
      abortLoad(casesLoadRef);
      abortLoad(contactsLoadRef);
      abortLoad(opportunitiesLoadRef);
      abortLoad(tasksLoadRef);
      abortLoad(boardLoadRef);
    };
  }, []);

  const loadAccounts = useCallback(
    async ({ append = false, cursor = null, search = "" }: LoadOptions = {}) => {
      const controller = beginAbortableLoad(accountsLoadRef);
      setAccountsLoading(true);
      try {
        const data = await fetchJson<ApiEnvelope & { accounts?: Account[] }>(
          buildEndpoint(endpoint, { entity: "accounts", limit: PAGE_LIMIT, cursor, search }),
          { signal: controller.signal },
        );
        if (controller.signal.aborted || !mountedRef.current) return;
        const rows = data.accounts ?? [];
        setAccounts((prev) => (append ? dedupeById([...prev, ...rows]) : rows));
        setAccountCursor(data.nextCursor ?? null);
      } catch (err) {
        if (isAbortError(err)) return;
        throw err;
      } finally {
        if (accountsLoadRef.current === controller) {
          accountsLoadRef.current = null;
          if (mountedRef.current) setAccountsLoading(false);
        }
      }
    },
    [endpoint],
  );

  const loadCases = useCallback(
    async ({ append = false, cursor = null, search = "" }: LoadOptions = {}) => {
      const controller = beginAbortableLoad(casesLoadRef);
      setCasesLoading(true);
      try {
        const data = await fetchJson<ApiEnvelope & { cases?: Case[] }>(
          buildEndpoint(endpoint, { entity: "cases", limit: PAGE_LIMIT, cursor, search }),
          { signal: controller.signal },
        );
        if (controller.signal.aborted || !mountedRef.current) return;
        const rows = data.cases ?? [];
        setCases((prev) => (append ? dedupeById([...prev, ...rows]) : rows));
        setCaseCursor(data.nextCursor ?? null);
      } catch (err) {
        if (isAbortError(err)) return;
        throw err;
      } finally {
        if (casesLoadRef.current === controller) {
          casesLoadRef.current = null;
          if (mountedRef.current) setCasesLoading(false);
        }
      }
    },
    [endpoint],
  );

  const loadContacts = useCallback(
    async ({ append = false, cursor = null, search = "" }: LoadOptions = {}) => {
      const controller = beginAbortableLoad(contactsLoadRef);
      setContactsLoading(true);
      try {
        const data = await fetchJson<ApiEnvelope & { contacts?: Contact[] }>(
          buildEndpoint(endpoint, { entity: "contacts", limit: PAGE_LIMIT, cursor, search }),
          { signal: controller.signal },
        );
        if (controller.signal.aborted || !mountedRef.current) return;
        const rows = data.contacts ?? [];
        setContacts((prev) => (append ? dedupeById([...prev, ...rows]) : rows));
        setContactCursor(data.nextCursor ?? null);
      } catch (err) {
        if (isAbortError(err)) return;
        throw err;
      } finally {
        if (contactsLoadRef.current === controller) {
          contactsLoadRef.current = null;
          if (mountedRef.current) setContactsLoading(false);
        }
      }
    },
    [endpoint],
  );

  const loadOpportunities = useCallback(
    async ({ append = false, cursor = null, search = "" }: LoadOptions = {}) => {
      const controller = beginAbortableLoad(opportunitiesLoadRef);
      setOppsLoading(true);
      try {
        const data = await fetchJson<ApiEnvelope & { opportunities?: Opportunity[] }>(
          buildEndpoint(endpoint, { entity: "opportunities", limit: PAGE_LIMIT, cursor, search }),
          { signal: controller.signal },
        );
        if (controller.signal.aborted || !mountedRef.current) return;
        const rows = data.opportunities ?? [];
        setOpps((prev) => (append ? dedupeById([...prev, ...rows]) : rows));
        setOppCursor(data.nextCursor ?? null);
      } catch (err) {
        if (isAbortError(err)) return;
        throw err;
      } finally {
        if (opportunitiesLoadRef.current === controller) {
          opportunitiesLoadRef.current = null;
          if (mountedRef.current) setOppsLoading(false);
        }
      }
    },
    [endpoint],
  );

  const loadTasks = useCallback(
    async ({ append = false, cursor = null, due = "overdue" }: TaskLoadOptions = {}) => {
      const controller = beginAbortableLoad(tasksLoadRef);
      setTasksLoading(true);
      try {
        const data = await fetchJson<ApiEnvelope & { tasks?: CrmTask[] }>(
          buildEndpoint(endpoint, {
            entity: "tasks",
            due,
            today: localDateParam(),
            limit: PAGE_LIMIT,
            cursor,
          }),
          { signal: controller.signal },
        );
        if (controller.signal.aborted || !mountedRef.current) return;
        const rows = data.tasks ?? [];
        setTasks((prev) => (append ? dedupeById([...prev, ...rows]) : rows));
        setTaskCursor(data.nextCursor ?? null);
      } catch (err) {
        if (isAbortError(err)) return;
        throw err;
      } finally {
        if (tasksLoadRef.current === controller) {
          tasksLoadRef.current = null;
          if (mountedRef.current) setTasksLoading(false);
        }
      }
    },
    [endpoint],
  );

  const loadPipelineConfig = useCallback(async () => {
    const [pipelineData, stageData] = await Promise.all([
      fetchJson<ApiEnvelope & { pipelines?: Pipeline[] }>(
        buildEndpoint(endpoint, { entity: "pipelines" }),
      ),
      fetchJson<ApiEnvelope & { stages?: PipelineStage[] }>(
        buildEndpoint(endpoint, { entity: "stages" }),
      ),
    ]);
    setPipelines(pipelineData.pipelines ?? []);
    setStages(stageData.stages ?? []);
  }, [endpoint]);

  const loadBoardOpportunities = useCallback(async () => {
    const controller = beginAbortableLoad(boardLoadRef);
    setBoardLoading(true);
    try {
      const rows: Opportunity[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      let complete = true;

      do {
        const data: ApiEnvelope & { opportunities?: Opportunity[] } = await fetchJson<
          ApiEnvelope & { opportunities?: Opportunity[] }
        >(
          buildEndpoint(endpoint, {
            entity: "opportunities",
            limit: BOARD_PAGE_LIMIT,
            cursor,
          }),
          { signal: controller.signal },
        );
        if (controller.signal.aborted || !mountedRef.current) return;
        rows.push(...(data.opportunities ?? []));
        const next: string | null = data.nextCursor ?? null;
        if (next && seenCursors.has(next)) {
          complete = false;
          cursor = null;
        } else {
          if (next) seenCursors.add(next);
          cursor = next;
        }
      } while (cursor && !controller.signal.aborted);

      if (controller.signal.aborted || !mountedRef.current) return;
      setBoardOpps(dedupeById(rows));
      setBoardComplete(complete);
      setBoardLoaded(true);
    } catch (err) {
      if (isAbortError(err)) return;
      throw err;
    } finally {
      if (boardLoadRef.current === controller) {
        boardLoadRef.current = null;
        if (mountedRef.current) setBoardLoading(false);
      }
    }
  }, [endpoint]);

  const refreshAll = useCallback(async (entity?: CrmEntity) => {
    const jobs: Promise<void>[] = [loadBoardOpportunities()];

    if (entity === "stages" || entity === "pipelines") {
      jobs.push(loadPipelineConfig());
    } else if (entity === "accounts") {
      jobs.push(loadAccounts({ search: debouncedAccountSearch }));
    } else if (entity === "cases") {
      jobs.push(loadCases({ search: debouncedCaseSearch }));
    } else if (entity === "contacts") {
      jobs.push(loadContacts({ search: debouncedContactSearch }));
    } else if (entity === "opportunities") {
      jobs.push(loadOpportunities({ search: debouncedOppSearch }));
    } else if (entity === "tasks") {
      jobs.push(loadTasks({ due: taskDue }));
    } else if (tab === "pipeline") {
      jobs.push(loadOpportunities({ search: debouncedOppSearch }));
    } else if (tab === "accounts") {
      jobs.push(loadAccounts({ search: debouncedAccountSearch }));
    } else if (tab === "cases") {
      jobs.push(loadCases({ search: debouncedCaseSearch }));
    } else if (tab === "contacts") {
      jobs.push(loadContacts({ search: debouncedContactSearch }));
    } else {
      jobs.push(loadTasks({ due: taskDue }));
    }

    await Promise.all(jobs);
  }, [
    debouncedAccountSearch,
    debouncedCaseSearch,
    debouncedContactSearch,
    debouncedOppSearch,
    loadAccounts,
    loadBoardOpportunities,
    loadCases,
    loadContacts,
    loadOpportunities,
    loadPipelineConfig,
    loadTasks,
    tab,
    taskDue,
  ]);

  useEffect(() => {
    // Nothing in `loading`/`ready` is read while setup is required — render
    // takes the early-return callout below instead of this view's body —
    // so there is nothing to set here. WAL-593.
    if (setupRequired) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setBoardLoaded(false);
      try {
        await Promise.all([
          loadAccounts({ search: "" }),
          loadCases({ search: "" }),
          loadContacts({ search: "" }),
          loadOpportunities({ search: "" }),
          loadTasks({ due: "overdue" }),
          loadPipelineConfig(),
          loadBoardOpportunities(),
        ]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load CRM data.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    loadAccounts,
    loadBoardOpportunities,
    loadCases,
    loadContacts,
    loadOpportunities,
    loadPipelineConfig,
    loadTasks,
    setupRequired,
  ]);

  useEffect(() => {
    if (!ready || setupRequired) return;
    let cancelled = false;
    (async () => {
      try {
        await loadAccounts({ search: debouncedAccountSearch });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load accounts.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedAccountSearch, loadAccounts, ready, setupRequired]);

  useEffect(() => {
    if (!ready || setupRequired) return;
    let cancelled = false;
    (async () => {
      try {
        await loadCases({ search: debouncedCaseSearch });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load cases.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedCaseSearch, loadCases, ready, setupRequired]);

  useEffect(() => {
    if (!ready || setupRequired) return;
    let cancelled = false;
    (async () => {
      try {
        await loadContacts({ search: debouncedContactSearch });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load contacts.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedContactSearch, loadContacts, ready, setupRequired]);

  useEffect(() => {
    if (!ready || setupRequired) return;
    let cancelled = false;
    (async () => {
      try {
        await loadOpportunities({ search: debouncedOppSearch });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load opportunities.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedOppSearch, loadOpportunities, ready, setupRequired]);

  useEffect(() => {
    if (!ready || setupRequired) return;
    let cancelled = false;
    (async () => {
      try {
        await loadTasks({ due: taskDue });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load tasks.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTasks, ready, setupRequired, taskDue]);

  // Generic mutation against /api/crm-records. Shows a transient notice and reloads.
  const mutate = useCallback(
    async (method: "POST" | "PATCH", body: Record<string, unknown>, okMsg: string): Promise<boolean> => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        await fetchJson<ApiEnvelope>(endpoint, {
          method,
          body: JSON.stringify(body),
        });
        await refreshAll(typeof body.entity === "string" ? (body.entity as CrmEntity) : undefined);
        setNotice(okMsg);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [endpoint, refreshAll],
  );

  const archiveEntity = useCallback(
    async (
      entity: "accounts" | "cases" | "contacts" | "opportunities",
      id: string,
      label: string,
      okMsg: string,
    ): Promise<boolean> => {
      if (!window.confirm(`Archive ${label}? It will disappear from active CRM lists.`)) return false;
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        await fetchJson<ApiEnvelope>(buildEndpoint(endpoint, { entity, id }), { method: "DELETE" });
        await refreshAll(entity);
        setNotice(okMsg);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Archive failed.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [endpoint, refreshAll],
  );

  const accountName = useCallback(
    (id: string | null) => (id ? (accounts.find((a) => a.id === id)?.name ?? "—") : "—"),
    [accounts],
  );

  const openOpportunity = useCallback((opp: Opportunity) => {
    setSelectedOppId(opp.id);
    setSelectedOppRecord(opp);
  }, []);

  const openOpportunityById = useCallback(
    async (id: string) => {
      const loaded = opps.find((o) => o.id === id) ?? boardOpps.find((o) => o.id === id);
      if (loaded) {
        openOpportunity(loaded);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const data = await fetchJson<ApiEnvelope & { opportunity?: Opportunity }>(
          buildEndpoint(endpoint, { entity: "opportunities", id }),
        );
        if (!data.opportunity) throw new Error("Opportunity not found.");
        openOpportunity(data.opportunity);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open opportunity.");
      } finally {
        setBusy(false);
      }
    },
    [boardOpps, endpoint, openOpportunity, opps],
  );

  const handleOpportunityStatus = useCallback(
    (opp: Opportunity, status: OpportunityStatus) => {
      if (status === opp.status) return;
      if (status === "lost") {
        setLostRequest(opp);
        return;
      }
      void mutate(
        "PATCH",
        { entity: "opportunities", id: opp.id, status, lost_reason: null },
        `Marked ${status}.`,
      );
    },
    [mutate],
  );

  const selectedOpp =
    selectedOppId == null
      ? null
      : opps.find((o) => o.id === selectedOppId) ??
        boardOpps.find((o) => o.id === selectedOppId) ??
        selectedOppRecord;
  const editingAccount = editingAccountId
    ? accounts.find((a) => a.id === editingAccountId) ?? null
    : null;
  const editingCase = editingCaseId
    ? cases.find((c) => c.id === editingCaseId) ?? null
    : null;
  const editingContact = editingContactId
    ? contacts.find((c) => c.id === editingContactId) ?? null
    : null;

  // --- pipeline KPIs (uses the tested pipeline.ts helpers) ------------------
  const { open: openOpps } = openVsClosed(boardOpps);
  const weighted = weightedPipelineValue(boardOpps, stages);
  const wonCount = boardOpps.filter((o) => o.status === "won").length;
  const lostCount = boardOpps.filter((o) => o.status === "lost").length;
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;
  const summary = pipelineByStage(openOpps, stages);
  const boardScope = !boardLoaded || boardLoading
    ? "Pipeline KPIs loading all opportunity pages..."
    : boardComplete
      ? `Pipeline KPIs include all ${boardOpps.length} loaded opportunity records; the table below is paginated.`
      : `Pipeline KPIs include ${boardOpps.length} loaded opportunity records; pagination stopped early, so totals are partial.`;

  if (setupRequired) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 860 }}>
          <header className="page-head">
            <span className="eyebrow">CRM</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Setup required.</strong> CRM is not yet configured for this site. Contact your
            administrator.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="container" style={{ maxWidth: 1100 }}>
        <header className="page-head">
          <span className="eyebrow">CRM</span>
          <h1>{title}</h1>
        </header>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          {shown.map((name) => (
            <button
              key={name}
              className={`btn ${tab === name ? "" : "ghost"}`}
              onClick={() => setTab(name)}
            >
              {TAB_LABELS[name]}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {tab === "pipeline" ? (
            <>
              <button className="btn" onClick={() => setShowOppForm((v) => !v)} disabled={busy}>
                {showOppForm ? "Cancel" : "New opportunity"}
              </button>
              <button className="btn ghost" onClick={() => setShowSettings((v) => !v)} disabled={busy}>
                Pipeline settings
              </button>
            </>
          ) : tab === "cases" ? (
            <button className="btn" onClick={() => setShowCaseForm((v) => !v)} disabled={busy}>
              {showCaseForm ? "Cancel" : "New case"}
            </button>
          ) : tab === "accounts" ? (
            <button className="btn" onClick={() => setShowAcctForm((v) => !v)} disabled={busy}>
              {showAcctForm ? "Cancel" : "New account"}
            </button>
          ) : tab === "contacts" ? (
            <button className="btn" onClick={() => setShowContactForm((v) => !v)} disabled={busy}>
              {showContactForm ? "Cancel" : "New contact"}
            </button>
          ) : null}
        </div>

        {notice ? <p className="form-msg" style={{ color: "var(--accent)" }}>{notice}</p> : null}
        {error ? <p role="alert" className="form-msg error">{error}</p> : null}

        {loading ? (
          <p className="price-note">Loading…</p>
        ) : tab === "pipeline" ? (
          <>
            {showOppForm ? (
              <OpportunityForm
                mode="create"
                accounts={accounts}
                contacts={contacts}
                stages={stages}
                busy={busy}
                onSubmit={async (body) => {
                  const ok = await mutate("POST", { entity: "opportunities", ...body }, "Opportunity created.");
                  if (ok) setShowOppForm(false);
                }}
              />
            ) : null}

            {showSettings ? (
              <StageSettingsPanel
                pipelines={pipelines}
                stages={stages}
                busy={busy}
                onCreate={async (body) =>
                  mutate("POST", { entity: "stages", ...body }, "Stage created.")
                }
                onUpdate={async (stage, body) =>
                  mutate("PATCH", { entity: "stages", id: stage.id, ...body }, "Stage updated.")
                }
                onReorder={async (orderedIds) =>
                  mutate("PATCH", { entity: "stages", orderedIds }, "Stages reordered.")
                }
              />
            ) : null}

            <section style={{ margin: "1.5rem 0 1.5rem" }}>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
                <Kpi label="Weighted pipeline" value={formatUsd(weighted)} />
                <Kpi label="Open opportunities" value={String(openOpps.length)} />
                <Kpi label="Won / Lost" value={`${wonCount} / ${lostCount}`} />
                <Kpi label="Win rate" value={winRate == null ? "—" : `${winRate}%`} />
              </div>
              <p className="price-note" style={{ margin: "0 0 1rem" }}>{boardScope}</p>
              <h2 className="section-title" style={{ marginBottom: "0.75rem" }}>Pipeline</h2>
              {stages.length === 0 ? (
                <p className="price-note">No pipeline stages configured.</p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                    gap: "0.75rem",
                  }}
                >
                  {summary.map(({ stage, count, totalAmount }) => (
                    <div key={stage.id} className="panel pad" style={{ textAlign: "center" }}>
                      <span className="eyebrow">{stage.name}</span>
                      <p className="price" style={{ fontSize: "1.5rem", margin: "0.25rem 0 0.1rem" }}>
                        {count}
                      </p>
                      <span className="price-note">{totalAmount > 0 ? formatUsd(totalAmount) : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "end", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                <h2 className="section-title" style={{ marginBottom: 0 }}>Opportunities</h2>
                <SearchBox
                  label="Search opportunities"
                  value={oppSearch}
                  onChange={setOppSearch}
                  loading={oppsLoading}
                />
              </div>
              {opps.length === 0 ? (
                <p className="price-note">
                  {debouncedOppSearch ? "No opportunities match this search." : "No opportunities yet — create one above."}
                </p>
              ) : (
                <div className="panel" style={{ overflowX: "auto" }}>
                  <table className="data-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Account</th>
                        <th>Amount</th>
                        <th>Stage</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {opps.map((opp) => (
                        <tr key={opp.id}>
                          <td>
                            <InlineButton onClick={() => openOpportunity(opp)}>
                              {opp.name}
                            </InlineButton>
                          </td>
                          <td>{accountName(opp.account_id)}</td>
                          <td>{opp.amount != null ? formatUsd(opp.amount) : "—"}</td>
                          <td>
                            <select
                              value={opp.stage_id ?? ""}
                              disabled={busy}
                              onChange={(e) =>
                                mutate(
                                  "PATCH",
                                  { entity: "opportunities", id: opp.id, stage_id: e.target.value || null },
                                  "Stage updated.",
                                )
                              }
                            >
                              <option value="">—</option>
                              {stages.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={opp.status}
                              disabled={busy}
                              onChange={(e) =>
                                handleOpportunityStatus(opp, e.target.value as OpportunityStatus)
                              }
                            >
                              {OPPORTUNITY_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button className="btn ghost" onClick={() => openOpportunity(opp)}>
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <LoadMoreButton
                cursor={oppCursor}
                loading={oppsLoading}
                onClick={() =>
                  void loadOpportunities({ append: true, cursor: oppCursor, search: debouncedOppSearch })
                }
              />
            </section>
          </>
        ) : tab === "cases" ? (
          <>
            {showCaseForm ? (
              <CaseForm
                mode="create"
                accounts={accounts}
                contacts={contacts}
                busy={busy}
                onSubmit={async (body) => {
                  const ok = await mutate("POST", { entity: "cases", ...body }, "Case created.");
                  if (ok) setShowCaseForm(false);
                }}
              />
            ) : null}
            {editingCase ? (
              <CaseForm
                key={editingCase.id}
                mode="edit"
                initial={editingCase}
                accounts={accounts}
                contacts={contacts}
                busy={busy}
                onCancel={() => setEditingCaseId(null)}
                onSubmit={async (body) => {
                  const ok = await mutate(
                    "PATCH",
                    { entity: "cases", id: editingCase.id, ...body },
                    "Case updated.",
                  );
                  if (ok) setEditingCaseId(null);
                }}
              />
            ) : null}
            <section style={{ marginTop: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "end", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                <h2 className="section-title" style={{ marginBottom: 0 }}>Cases</h2>
                <SearchBox
                  label="Search cases"
                  value={caseSearch}
                  onChange={setCaseSearch}
                  loading={casesLoading}
                />
              </div>
              {cases.length === 0 ? (
                <p className="price-note">
                  {debouncedCaseSearch ? "No cases match this search." : "No cases yet — create one above."}
                </p>
              ) : (
                <div className="panel" style={{ overflowX: "auto" }}>
                  <table className="data-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>Title</th>
                        <th>Account</th>
                        <th>Status</th>
                        <th>Incident date</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {cases.map((c) => (
                        <tr key={c.id}>
                          <td style={{ fontFamily: "var(--font-mono, monospace)" }}>{c.case_number}</td>
                          <td>{c.title || "—"}</td>
                          <td>{accountName(c.account_id)}</td>
                          <td>{CASE_STATUS_LABEL[c.status]}</td>
                          <td>{c.incident_date ?? "—"}</td>
                          <td>
                            <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                              <button className="btn ghost" disabled={busy} onClick={() => setEditingCaseId(c.id)}>
                                Edit
                              </button>
                              <button
                                className="btn ghost"
                                disabled={busy}
                                onClick={async () => {
                                  const ok = await archiveEntity(
                                    "cases",
                                    c.id,
                                    `case "${c.case_number}"`,
                                    "Case archived.",
                                  );
                                  if (ok && editingCaseId === c.id) setEditingCaseId(null);
                                }}
                              >
                                Archive
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <LoadMoreButton
                cursor={caseCursor}
                loading={casesLoading}
                onClick={() =>
                  void loadCases({ append: true, cursor: caseCursor, search: debouncedCaseSearch })
                }
              />
            </section>
          </>
        ) : tab === "accounts" ? (
          <>
            {showAcctForm ? (
              <AccountForm
                mode="create"
                busy={busy}
                onSubmit={async (body) => {
                  const ok = await mutate("POST", { entity: "accounts", ...body }, "Account created.");
                  if (ok) setShowAcctForm(false);
                }}
              />
            ) : null}
            {editingAccount ? (
              <AccountForm
                key={editingAccount.id}
                mode="edit"
                initial={editingAccount}
                busy={busy}
                onCancel={() => setEditingAccountId(null)}
                onSubmit={async (body) => {
                  const ok = await mutate(
                    "PATCH",
                    { entity: "accounts", id: editingAccount.id, ...body },
                    "Account updated.",
                  );
                  if (ok) setEditingAccountId(null);
                }}
              />
            ) : null}
            <section style={{ marginTop: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "end", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                <h2 className="section-title" style={{ marginBottom: 0 }}>Accounts</h2>
                <SearchBox
                  label="Search accounts"
                  value={accountSearch}
                  onChange={setAccountSearch}
                  loading={accountsLoading}
                />
              </div>
              {accounts.length === 0 ? (
                <p className="price-note">
                  {debouncedAccountSearch ? "No accounts match this search." : "No accounts yet — create one above."}
                </p>
              ) : (
                <>
                  <div className="panel" style={{ overflowX: "auto" }}>
                    <table className="data-table" style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Industry</th>
                          <th>Domain</th>
                          <th>Loaded contacts</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.map((a) => (
                          <tr key={a.id}>
                            <td>{a.name}</td>
                            <td>{a.industry ?? "—"}</td>
                            <td>{a.domain ?? "—"}</td>
                            <td>{contacts.filter((c) => c.account_id === a.id).length}</td>
                            <td>
                              <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                                <button className="btn ghost" disabled={busy} onClick={() => setEditingAccountId(a.id)}>
                                  Edit
                                </button>
                                <button
                                  className="btn ghost"
                                  disabled={busy}
                                  onClick={async () => {
                                    const ok = await archiveEntity("accounts", a.id, `account "${a.name}"`, "Account archived.");
                                    if (ok && editingAccountId === a.id) setEditingAccountId(null);
                                  }}
                                >
                                  Archive
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="price-note" style={{ marginTop: "0.5rem" }}>
                    Contact counts reflect the contacts currently loaded in this operator view.
                  </p>
                </>
              )}
              <LoadMoreButton
                cursor={accountCursor}
                loading={accountsLoading}
                onClick={() =>
                  void loadAccounts({ append: true, cursor: accountCursor, search: debouncedAccountSearch })
                }
              />
            </section>
          </>
        ) : tab === "contacts" ? (
          <>
            {showContactForm ? (
              <ContactForm
                mode="create"
                accounts={accounts}
                busy={busy}
                onSubmit={async (body) => {
                  const ok = await mutate("POST", { entity: "contacts", ...body }, "Contact created.");
                  if (ok) setShowContactForm(false);
                }}
              />
            ) : null}
            {editingContact ? (
              <ContactForm
                key={editingContact.id}
                mode="edit"
                initial={editingContact}
                accounts={accounts}
                busy={busy}
                onCancel={() => setEditingContactId(null)}
                onSubmit={async (body) => {
                  const ok = await mutate(
                    "PATCH",
                    { entity: "contacts", id: editingContact.id, ...body },
                    "Contact updated.",
                  );
                  if (ok) setEditingContactId(null);
                }}
              />
            ) : null}
            <section style={{ marginTop: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "end", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                <h2 className="section-title" style={{ marginBottom: 0 }}>Contacts</h2>
                <SearchBox
                  label="Search contacts"
                  value={contactSearch}
                  onChange={setContactSearch}
                  loading={contactsLoading}
                />
              </div>
              {contacts.length === 0 ? (
                <p className="price-note">
                  {debouncedContactSearch ? "No contacts match this search." : "No contacts yet — create one above."}
                </p>
              ) : (
                <div className="panel" style={{ overflowX: "auto" }}>
                  <table className="data-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Title</th>
                        <th>Account</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((c) => (
                        <tr key={c.id}>
                          <td>{contactLabel(c)}</td>
                          <td>{c.title ?? "—"}</td>
                          <td>{accountName(c.account_id)}</td>
                          <td>{c.email ?? "—"}</td>
                          <td>{c.phone ?? "—"}</td>
                          <td>
                            <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                              <button className="btn ghost" disabled={busy} onClick={() => setEditingContactId(c.id)}>
                                Edit
                              </button>
                              <button
                                className="btn ghost"
                                disabled={busy}
                                onClick={async () => {
                                  const ok = await archiveEntity(
                                    "contacts",
                                    c.id,
                                    `contact "${contactLabel(c)}"`,
                                    "Contact archived.",
                                  );
                                  if (ok && editingContactId === c.id) setEditingContactId(null);
                                }}
                              >
                                Archive
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <LoadMoreButton
                cursor={contactCursor}
                loading={contactsLoading}
                onClick={() =>
                  void loadContacts({ append: true, cursor: contactCursor, search: debouncedContactSearch })
                }
              />
            </section>
          </>
        ) : (
          <TasksPanel
            tasks={tasks}
            due={taskDue}
            loading={tasksLoading}
            busy={busy}
            nextCursor={taskCursor}
            onDueChange={setTaskDue}
            onLoadMore={() => void loadTasks({ append: true, cursor: taskCursor, due: taskDue })}
            onToggle={async (task, done) =>
              mutate("PATCH", { entity: "tasks", id: task.id, done }, done ? "Task completed." : "Task reopened.")
            }
            onOpenOpportunity={(id) => void openOpportunityById(id)}
          />
        )}
      </section>

      {selectedOpp ? (
        <OpportunityDrawer
          endpoint={endpoint}
          opp={selectedOpp}
          accounts={accounts}
          contacts={contacts}
          stages={stages}
          accountName={accountName(selectedOpp.account_id)}
          stageName={stages.find((s) => s.id === selectedOpp.stage_id)?.name ?? "—"}
          parentBusy={busy}
          onClose={() => {
            setSelectedOppId(null);
            setSelectedOppRecord(null);
          }}
          onOpportunityPatch={(body, message) =>
            mutate("PATCH", { entity: "opportunities", id: selectedOpp.id, ...body }, message)
          }
          onArchive={async () => {
            const ok = await archiveEntity(
              "opportunities",
              selectedOpp.id,
              `opportunity "${selectedOpp.name}"`,
              "Opportunity archived.",
            );
            if (ok) {
              setSelectedOppId(null);
              setSelectedOppRecord(null);
            }
            return ok;
          }}
        />
      ) : null}

      {lostRequest ? (
        <LostReasonModal
          opp={lostRequest}
          busy={busy}
          onCancel={() => setLostRequest(null)}
          onConfirm={async (lostReason) => {
            const ok = await mutate(
              "PATCH",
              {
                entity: "opportunities",
                id: lostRequest.id,
                status: "lost",
                lost_reason: lostReason.trim() || null,
              },
              "Marked lost.",
            );
            if (ok) setLostRequest(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel pad" style={{ flex: "1 1 160px", minWidth: 140 }}>
      <span className="eyebrow" style={{ display: "block" }}>{label}</span>
      <p className="price" style={{ fontSize: "1.4rem", margin: "0.25rem 0 0" }}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span className="eyebrow" style={{ display: "block", marginBottom: "0.25rem" }}>{label}</span>
      {children}
    </label>
  );
}

function InlineButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="linklike"
      style={{
        background: "none",
        border: "none",
        padding: 0,
        color: "var(--accent, #b45309)",
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SearchBox({
  label,
  value,
  onChange,
  loading,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  loading: boolean;
}) {
  return (
    <Field label={label}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={label}
          style={{ minWidth: "min(100%, 240px)" }}
        />
        {loading ? <span className="price-note">Loading…</span> : null}
      </div>
    </Field>
  );
}

function LoadMoreButton({
  cursor,
  loading,
  onClick,
}: {
  cursor: string | null;
  loading: boolean;
  onClick: () => void;
}) {
  if (!cursor) return null;
  return (
    <div style={{ marginTop: "0.85rem" }}>
      <button className="btn ghost" disabled={loading} onClick={onClick}>
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}

function parseProbability(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function parseNonNegativeInteger(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function StageSettingsPanel({
  pipelines,
  stages,
  busy,
  onCreate,
  onUpdate,
  onReorder,
}: {
  pipelines: Pipeline[];
  stages: PipelineStage[];
  busy: boolean;
  onCreate: (body: Record<string, unknown>) => Promise<boolean>;
  onUpdate: (stage: PipelineStage, body: Record<string, unknown>) => Promise<boolean>;
  onReorder: (orderedIds: string[]) => Promise<boolean>;
}) {
  const pipelineChoices = useMemo<Pipeline[]>(() => {
    const byId = new Map<string, Pipeline>();
    for (const pipeline of pipelines) byId.set(pipeline.id, pipeline);
    for (const stage of stages) {
      if (stage.pipeline_id && !byId.has(stage.pipeline_id)) {
        byId.set(stage.pipeline_id, {
          id: stage.pipeline_id,
          name: "Pipeline",
          is_active: true,
          order_index: 0,
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.order_index - b.order_index || a.name.localeCompare(b.name));
  }, [pipelines, stages]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  // No pipeline is explicitly selected yet on first render — fall back to the
  // first available choice instead of syncing it into state via an effect.
  // WAL-593: this used to be a `useEffect` that set `selectedPipelineId` once
  // `pipelineChoices` loaded; deriving it here removes an extra render and
  // the sync-from-prop lint warning without changing what the user sees.
  const effectivePipelineId = selectedPipelineId || pipelineChoices[0]?.id || "";
  const [drafts, setDrafts] = useState<Record<string, StageDraft>>({});
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("0");
  const [newRottenDays, setNewRottenDays] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const selectedStages = useMemo(
    () =>
      stages
        .filter((stage) => stage.pipeline_id === effectivePipelineId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [effectivePipelineId, stages],
  );

  const updateDraft = (
    stageId: string,
    patch: Partial<StageDraft>,
  ) => {
    setDrafts((prev) => {
      const stage = stages.find((s) => s.id === stageId);
      const current = prev[stageId] ?? (stage ? defaultStageDraft(stage) : undefined);
      if (!current) return prev;
      return { ...prev, [stageId]: { ...current, ...patch } };
    });
  };

  const createStage = async () => {
    if (!effectivePipelineId) {
      setLocalErr("Select a pipeline before creating a stage.");
      return;
    }
    if (!newName.trim()) {
      setLocalErr("Stage name is required.");
      return;
    }
    const probability = parseProbability(newWeight);
    if (probability == null) {
      setLocalErr("Probability must be between 0 and 1.");
      return;
    }
    const rottenDays = parseNonNegativeInteger(newRottenDays);
    if (newRottenDays.trim() && rottenDays == null) {
      setLocalErr("Rotten days must be a non-negative whole number.");
      return;
    }
    setLocalErr(null);
    const ok = await onCreate({
      pipeline_id: effectivePipelineId,
      name: newName.trim(),
      sort_order: selectedStages.length,
      probability_weight: probability,
      rotten_days: rottenDays,
    });
    if (ok) {
      setNewName("");
      setNewWeight("0");
      setNewRottenDays("");
    }
  };

  const saveStage = async (stage: PipelineStage) => {
    const draft = drafts[stage.id] ?? defaultStageDraft(stage);
    if (!draft.name.trim()) {
      setLocalErr("Stage name is required.");
      return;
    }
    const probability = parseProbability(draft.probability_weight);
    if (probability == null) {
      setLocalErr("Probability must be between 0 and 1.");
      return;
    }
    const rottenDays = parseNonNegativeInteger(draft.rotten_days);
    if (draft.rotten_days.trim() && rottenDays == null) {
      setLocalErr("Rotten days must be a non-negative whole number.");
      return;
    }
    setLocalErr(null);
    await onUpdate(stage, {
      name: draft.name.trim(),
      probability_weight: probability,
      active: draft.active,
      rotten_days: rottenDays,
    });
  };

  const moveStage = async (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedStages.length) return;
    const orderedIds = selectedStages.map((stage) => stage.id);
    [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[index]];
    setLocalErr(null);
    await onReorder(orderedIds);
  };

  return (
    <section className="panel pad" style={{ display: "grid", gap: "1rem", marginBottom: "1.5rem" }}>
      <div>
        <span className="eyebrow">Pipeline settings</span>
        <h2 className="section-title" style={{ margin: "0.25rem 0 0" }}>Stages</h2>
      </div>
      {localErr ? <p role="alert" className="form-msg error">{localErr}</p> : null}
      {pipelineChoices.length === 0 ? (
        <p className="price-note">No pipelines configured.</p>
      ) : (
        <>
          <Field label="Pipeline">
            <select value={effectivePipelineId} onChange={(e) => setSelectedPipelineId(e.target.value)}>
              {pipelineChoices.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="panel pad" style={{ display: "grid", gap: "0.75rem" }}>
            <span className="eyebrow">Create stage</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: "0.65rem", alignItems: "end" }}>
              <Field label="Name">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Proposal" />
              </Field>
              <Field label="Probability">
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={newWeight}
                  onChange={(e) => setNewWeight(e.target.value)}
                />
              </Field>
              <Field label="Rotten days">
                <input
                  type="number"
                  min="0"
                  value={newRottenDays}
                  onChange={(e) => setNewRottenDays(e.target.value)}
                />
              </Field>
              <button className="btn" disabled={busy || !newName.trim()} onClick={() => void createStage()}>
                Create
              </button>
            </div>
          </div>

          {selectedStages.length === 0 ? (
            <p className="price-note">No active stages in this pipeline.</p>
          ) : (
            <div className="panel" style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Name</th>
                    <th>Probability</th>
                    <th>Rotten days</th>
                    <th>Active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {selectedStages.map((stage, index) => {
                    const draft = drafts[stage.id] ?? defaultStageDraft(stage);
                    return (
                      <tr key={stage.id}>
                        <td>
                          <div style={{ display: "flex", gap: "0.35rem" }}>
                            <button className="btn ghost" disabled={busy || index === 0} onClick={() => void moveStage(index, -1)}>
                              Up
                            </button>
                            <button className="btn ghost" disabled={busy || index === selectedStages.length - 1} onClick={() => void moveStage(index, 1)}>
                              Down
                            </button>
                          </div>
                        </td>
                        <td>
                          <input
                            value={draft.name}
                            onChange={(e) => updateDraft(stage.id, { name: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            value={draft.probability_weight}
                            onChange={(e) => updateDraft(stage.id, { probability_weight: e.target.value })}
                            style={{ width: 110 }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            value={draft.rotten_days}
                            onChange={(e) => updateDraft(stage.id, { rotten_days: e.target.value })}
                            style={{ width: 110 }}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={draft.active}
                            onChange={(e) => updateDraft(stage.id, { active: e.target.checked })}
                          />
                        </td>
                        <td>
                          <button className="btn ghost" disabled={busy} onClick={() => void saveStage(stage)}>
                            Save
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="price-note">
            Retired stages are removed from active pipeline views after refresh.
          </p>
        </>
      )}
    </section>
  );
}

function TasksPanel({
  tasks,
  due,
  loading,
  busy,
  nextCursor,
  onDueChange,
  onLoadMore,
  onToggle,
  onOpenOpportunity,
}: {
  tasks: CrmTask[];
  due: TaskDueFilter;
  loading: boolean;
  busy: boolean;
  nextCursor: string | null;
  onDueChange: (due: TaskDueFilter) => void;
  onLoadMore: () => void;
  onToggle: (task: CrmTask, done: boolean) => Promise<boolean>;
  onOpenOpportunity: (id: string) => void;
}) {
  return (
    <section style={{ marginTop: "1.25rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {TASK_FILTERS.map((filter) => (
          <button
            key={filter.value}
            className={`btn ${due === filter.value ? "" : "ghost"}`}
            onClick={() => onDueChange(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {loading ? <p className="price-note">Loading…</p> : null}
      {tasks.length === 0 && !loading ? (
        <p className="price-note">No tasks in this bucket.</p>
      ) : (
        <div className="panel" style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Done</th>
                <th>Task</th>
                <th>Due date</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={task.done}
                      disabled={busy}
                      onChange={(e) => void onToggle(task, e.target.checked)}
                    />
                  </td>
                  <td>
                    {task.opportunity_id ? (
                      <InlineButton onClick={() => onOpenOpportunity(task.opportunity_id!)}>
                        {task.title}
                      </InlineButton>
                    ) : (
                      task.title
                    )}
                  </td>
                  <td>{task.due_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMoreButton cursor={nextCursor} loading={loading} onClick={onLoadMore} />
    </section>
  );
}

// --- Opportunity detail drawer ----------------------------------------------
// Self-contained for activities + per-opportunity tasks. Parent owns opportunity
// edits so the paginated lists and board KPIs stay synchronized.

function OpportunityDrawer({
  endpoint,
  opp,
  accounts,
  contacts,
  stages,
  accountName,
  stageName,
  parentBusy,
  onClose,
  onOpportunityPatch,
  onArchive,
}: {
  endpoint: string;
  opp: Opportunity;
  accounts: Account[];
  contacts: Contact[];
  stages: PipelineStage[];
  accountName: string;
  stageName: string;
  parentBusy: boolean;
  onClose: () => void;
  onOpportunityPatch: (body: Record<string, unknown>, message: string) => Promise<boolean>;
  onArchive: () => Promise<boolean>;
}) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [actType, setActType] = useState<ActivityType>("call");
  const [actBody, setActBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const dialogRef = useDialogFocusTrap<HTMLDivElement>();

  const load = useCallback(async () => {
    const [actData, taskData] = await Promise.all([
      fetchJson<ApiEnvelope & { activities?: Activity[] }>(
        buildEndpoint(endpoint, { entity: "activities", opportunityId: opp.id }),
      ),
      fetchJson<ApiEnvelope & { tasks?: CrmTask[] }>(
        buildEndpoint(endpoint, { entity: "tasks", opportunityId: opp.id }),
      ),
    ]);
    setActivities(actData.activities ?? []);
    setTasks(taskData.tasks ?? []);
  }, [endpoint, opp.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch {
        if (!cancelled) setErr("Could not load opportunity detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const mutate = useCallback(
    async (body: Record<string, unknown>, method: "POST" | "PATCH" = "POST"): Promise<boolean> => {
      setBusy(true);
      setErr(null);
      try {
        await fetchJson<ApiEnvelope>(endpoint, {
          method,
          body: JSON.stringify(body),
        });
        await load();
        return true;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Action failed.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [endpoint, load],
  );

  const logActivity = async () => {
    const ok = await mutate({
      entity: "activities",
      type: actType,
      opportunity_id: opp.id,
      ...(opp.account_id ? { account_id: opp.account_id } : {}),
      ...(opp.contact_id ? { contact_id: opp.contact_id } : {}),
      ...(actBody.trim() ? { body: actBody.trim() } : {}),
    });
    if (ok) setActBody("");
  };

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    const ok = await mutate({
      entity: "tasks",
      title: taskTitle.trim(),
      opportunity_id: opp.id,
      ...(taskDue ? { due_date: taskDue } : {}),
    });
    if (ok) {
      setTaskTitle("");
      setTaskDue("");
    }
  };

  const openTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Opportunity: ${opp.name}`}
      tabIndex={-1}
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }}
      />
      <aside
        className="panel"
        style={{
          position: "relative",
          width: "min(600px, 100%)",
          height: "100%",
          overflowY: "auto",
          borderRadius: 0,
          padding: "1.5rem",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
          <div>
            <span className="eyebrow">Opportunity</span>
            <h2 style={{ margin: "0.2rem 0 0" }}>{opp.name}</h2>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setEditing((v) => !v)} disabled={parentBusy}>
              {editing ? "Cancel" : "Edit"}
            </button>
            <button className="btn ghost" onClick={() => void onArchive()} disabled={parentBusy}>
              Archive
            </button>
            <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.35rem 1rem", margin: "1rem 0 1.5rem" }}>
          <dt className="eyebrow">Account</dt>
          <dd style={{ margin: 0 }}>{accountName}</dd>
          <dt className="eyebrow">Stage</dt>
          <dd style={{ margin: 0 }}>{stageName}</dd>
          <dt className="eyebrow">Amount</dt>
          <dd style={{ margin: 0 }}>{opp.amount != null ? formatUsd(opp.amount) : "—"}</dd>
          <dt className="eyebrow">Status</dt>
          <dd style={{ margin: 0 }}>{opp.status}</dd>
          <dt className="eyebrow">Close date</dt>
          <dd style={{ margin: 0 }}>{opp.close_date ?? "—"}</dd>
          {opp.status === "lost" && opp.lost_reason ? (
            <>
              <dt className="eyebrow">Lost reason</dt>
              <dd style={{ margin: 0 }}>{opp.lost_reason}</dd>
            </>
          ) : null}
        </dl>

        {editing ? (
          <OpportunityForm
            key={opp.id}
            mode="edit"
            initial={opp}
            accounts={accounts}
            contacts={contacts}
            stages={stages}
            busy={parentBusy}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              const ok = await onOpportunityPatch(body, "Opportunity updated.");
              if (ok) setEditing(false);
            }}
          />
        ) : null}

        {err ? <p role="alert" className="form-msg error">{err}</p> : null}

        {/* Tasks */}
        <section style={{ marginBottom: "1.75rem", marginTop: editing ? "1.25rem" : 0 }}>
          <h3 className="section-title" style={{ marginBottom: "0.5rem" }}>Follow-up tasks</h3>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="e.g. Send revised quote"
              style={{ flex: "2 1 200px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addTask();
              }}
            />
            <input
              type="date"
              value={taskDue}
              onChange={(e) => setTaskDue(e.target.value)}
              style={{ flex: "1 1 140px" }}
            />
            <button className="btn" disabled={busy || !taskTitle.trim()} onClick={() => void addTask()}>
              Add
            </button>
          </div>
          {loading ? (
            <p className="price-note">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="price-note">No tasks yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
              {[...openTasks, ...doneTasks].map((t) => (
                <li
                  key={t.id}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", opacity: t.done ? 0.55 : 1 }}
                >
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={busy}
                    onChange={(e) =>
                      void mutate({ entity: "tasks", id: t.id, done: e.target.checked }, "PATCH")
                    }
                  />
                  <span style={{ flex: 1, textDecoration: t.done ? "line-through" : "none" }}>
                    {t.title}
                  </span>
                  {t.due_date ? <span className="price-note">{t.due_date}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Activity timeline */}
        <section>
          <h3 className="section-title" style={{ marginBottom: "0.5rem" }}>Activity</h3>
          <div className="panel pad" style={{ display: "grid", gap: "0.5rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <select
                value={actType}
                onChange={(e) => setActType(e.target.value as ActivityType)}
                style={{ flex: "0 0 120px" }}
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                value={actBody}
                onChange={(e) => setActBody(e.target.value)}
                placeholder="What happened?"
                style={{ flex: "1 1 200px" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void logActivity();
                }}
              />
              <button className="btn" disabled={busy} onClick={() => void logActivity()}>
                Log
              </button>
            </div>
          </div>
          {loading ? (
            <p className="price-note">Loading…</p>
          ) : activities.length === 0 ? (
            <p className="price-note">No activity logged yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
              {activities.map((a) => (
                <li key={a.id} style={{ display: "flex", gap: "0.6rem" }}>
                  <span aria-hidden style={{ fontSize: "1.1rem" }}>{ACTIVITY_ICON[a.type]}</span>
                  <div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                      <strong style={{ textTransform: "capitalize" }}>{a.type}</strong>
                      <span className="price-note">{formatDateTime(a.occurred_at)}</span>
                    </div>
                    {a.body ? <p style={{ margin: "0.15rem 0 0" }}>{a.body}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

function LostReasonModal({
  opp,
  busy,
  onCancel,
  onConfirm,
}: {
  opp: Opportunity;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (lostReason: string) => Promise<void>;
}) {
  // `initial` is only ever read at mount: LostReasonModal is rendered from
  // `{lostRequest ? <LostReasonModal opp={lostRequest} .../> : null}` in the
  // parent, so a new `opp` always arrives via a fresh mount (the element
  // goes through `null` on every close), never as a prop change on a live
  // instance. WAL-593: the effect that resynced `lostReason` from `opp`
  // never fired with different data, so it was dead weight.
  const [lostReason, setLostReason] = useState(opp.lost_reason ?? "");
  const dialogRef = useDialogFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Mark ${opp.name} lost`}
      tabIndex={-1}
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: "1rem" }}
    >
      <div
        onClick={onCancel}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)" }}
      />
      <div className="panel pad" style={{ position: "relative", width: "min(460px, 100%)", display: "grid", gap: "0.85rem" }}>
        <div>
          <span className="eyebrow">Lost opportunity</span>
          <h2 className="section-title" style={{ margin: "0.25rem 0 0" }}>{opp.name}</h2>
        </div>
        <Field label="Lost reason">
          <textarea
            rows={3}
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={busy} onClick={() => void onConfirm(lostReason.trim())}>
            Mark lost
          </button>
        </div>
      </div>
    </div>
  );
}

function OpportunityForm({
  accounts,
  contacts,
  stages,
  busy,
  mode,
  initial,
  onCancel,
  onSubmit,
}: {
  accounts: Account[];
  contacts: Contact[];
  stages: PipelineStage[];
  busy: boolean;
  mode: "create" | "edit";
  initial?: Opportunity;
  onCancel?: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  // WAL-593: `initial` used to be resynced into these fields via an effect
  // keyed on its primitive values. The call site now remounts this form with
  // `key={initial.id}` when the edited record changes, so the `useState`
  // initializers below pick up fresh values for free — see the render call
  // site for the tradeoff this has on in-progress edits.
  const [name, setName] = useState(initial?.name ?? "");
  const [accountId, setAccountId] = useState(initial?.account_id ?? "");
  const [contactId, setContactId] = useState(initial?.contact_id ?? "");
  const [stageId, setStageId] = useState(initial?.stage_id ?? "");
  const [amount, setAmount] = useState(initial?.amount == null ? "" : String(initial.amount));
  const [closeDate, setCloseDate] = useState(initial?.close_date ?? "");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setLocalErr("Name is required.");
      return;
    }
    if (amount && !Number.isFinite(Number(amount))) {
      setLocalErr("Amount must be a number.");
      return;
    }
    setLocalErr(null);
    const base = {
      name: name.trim(),
      ...(mode === "edit"
        ? {
            account_id: accountId || null,
            contact_id: contactId || null,
            stage_id: stageId || null,
            amount: amount === "" ? null : Number(amount),
            close_date: closeDate || null,
          }
        : {
            ...(accountId ? { account_id: accountId } : {}),
            ...(contactId ? { contact_id: contactId } : {}),
            ...(stageId ? { stage_id: stageId } : {}),
            ...(amount ? { amount: Number(amount) } : {}),
            ...(closeDate ? { close_date: closeDate } : {}),
          }),
    };
    void onSubmit(base);
  };

  return (
    <div className="panel pad" style={{ display: "grid", gap: "0.75rem", maxWidth: 720 }}>
      <span className="eyebrow">{mode === "edit" ? "Edit opportunity" : "New opportunity"}</span>
      {localErr ? <p role="alert" className="form-msg error">{localErr}</p> : null}
      <Field label="Name *">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tri-State — annual MRO" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem" }}>
        <Field label="Account">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">—</option>
            {initial?.account_id && !accounts.some((a) => a.id === initial.account_id) ? (
              <option value={initial.account_id}>Current account</option>
            ) : null}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Contact">
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">—</option>
            {initial?.contact_id && !contacts.some((c) => c.id === initial.contact_id) ? (
              <option value={initial.contact_id}>Current contact</option>
            ) : null}
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{contactLabel(c)}</option>
            ))}
          </select>
        </Field>
        <Field label="Stage">
          <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">—</option>
            {initial?.stage_id && !stages.some((s) => s.id === initial.stage_id) ? (
              <option value={initial.stage_id}>Current stage</option>
            ) : null}
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Amount (USD)">
          <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Close date">
          <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
        </Field>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button className="btn" disabled={busy} onClick={submit}>
          {mode === "edit" ? "Save opportunity" : "Create opportunity"}
        </button>
        {onCancel ? (
          <button className="btn ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AccountForm({
  busy,
  mode,
  initial,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  mode: "create" | "edit";
  initial?: Account;
  onCancel?: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  // WAL-593: see OpportunityForm above — the call site remounts this form
  // with `key={initial.id}` on record change instead of resyncing via effect.
  const [name, setName] = useState(initial?.name ?? "");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [domain, setDomain] = useState(initial?.domain ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setLocalErr("Name is required.");
      return;
    }
    setLocalErr(null);
    void onSubmit({
      name: name.trim(),
      ...(mode === "edit"
        ? {
            industry: industry.trim() || null,
            domain: domain.trim() || null,
            notes: notes.trim() || null,
          }
        : {
            ...(industry.trim() ? { industry: industry.trim() } : {}),
            ...(domain.trim() ? { domain: domain.trim() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          }),
    });
  };

  return (
    <div className="panel pad" style={{ display: "grid", gap: "0.75rem", maxWidth: 720, marginBottom: "1rem" }}>
      <span className="eyebrow">{mode === "edit" ? "Edit account" : "New account"}</span>
      {localErr ? <p role="alert" className="form-msg error">{localErr}</p> : null}
      <Field label="Name *">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tri-State Manufacturing" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem" }}>
        <Field label="Industry">
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </Field>
        <Field label="Domain">
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </Field>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button className="btn" disabled={busy} onClick={submit}>
          {mode === "edit" ? "Save account" : "Create account"}
        </button>
        {onCancel ? (
          <button className="btn ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CaseForm({
  accounts,
  contacts,
  busy,
  mode,
  initial,
  onCancel,
  onSubmit,
}: {
  accounts: Account[];
  contacts: Contact[];
  busy: boolean;
  mode: "create" | "edit";
  initial?: Case;
  onCancel?: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  // WAL-611: see AccountForm above — the call site remounts this form
  // with `key={initial.id}` on record change instead of resyncing via effect.
  const [caseNumber, setCaseNumber] = useState(initial?.case_number ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState<CaseStatus>(initial?.status ?? "open");
  const [accountId, setAccountId] = useState(initial?.account_id ?? "");
  const [contactId, setContactId] = useState(initial?.contact_id ?? "");
  const [caseType, setCaseType] = useState(initial?.case_type ?? "");
  const [incidentDate, setIncidentDate] = useState(initial?.incident_date ?? "");
  const [incidentLocation, setIncidentLocation] = useState(initial?.incident_location ?? "");
  const [openedOn, setOpenedOn] = useState(initial?.opened_on ?? "");
  const [closedOn, setClosedOn] = useState(initial?.closed_on ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = () => {
    // Case number is the human key staff cite (a string, not an integer —
    // some carry an "F " prefix or a sub-letter like "2130a"). Never coerce it.
    if (!caseNumber.trim()) {
      setLocalErr("Case number is required.");
      return;
    }
    if (!title.trim()) {
      setLocalErr("Title is required.");
      return;
    }
    setLocalErr(null);
    void onSubmit({
      case_number: caseNumber.trim(),
      title: title.trim(),
      status,
      ...(mode === "edit"
        ? {
            account_id: accountId || null,
            contact_id: contactId || null,
            case_type: caseType.trim() || null,
            incident_date: incidentDate || null,
            incident_location: incidentLocation.trim() || null,
            opened_on: openedOn || null,
            closed_on: closedOn || null,
            notes: notes.trim() || null,
          }
        : {
            ...(accountId ? { account_id: accountId } : {}),
            ...(contactId ? { contact_id: contactId } : {}),
            ...(caseType.trim() ? { case_type: caseType.trim() } : {}),
            ...(incidentDate ? { incident_date: incidentDate } : {}),
            ...(incidentLocation.trim() ? { incident_location: incidentLocation.trim() } : {}),
            ...(openedOn ? { opened_on: openedOn } : {}),
            ...(closedOn ? { closed_on: closedOn } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          }),
    });
  };

  return (
    <div className="panel pad" style={{ display: "grid", gap: "0.75rem", maxWidth: 720, marginBottom: "1rem" }}>
      <span className="eyebrow">{mode === "edit" ? "Edit case" : "New case"}</span>
      {localErr ? <p role="alert" className="form-msg error">{localErr}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem" }}>
        <Field label="Case number *">
          <input value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} placeholder="e.g. F 2130a" />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)}>
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>{CASE_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Title *">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Attic fire, single-family residence" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem" }}>
        <Field label="Account">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">—</option>
            {initial?.account_id && !accounts.some((a) => a.id === initial.account_id) ? (
              <option value={initial.account_id}>Current account</option>
            ) : null}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Contact">
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">—</option>
            {initial?.contact_id && !contacts.some((c) => c.id === initial.contact_id) ? (
              <option value={initial.contact_id}>Current contact</option>
            ) : null}
            {contacts.map((c) => <option key={c.id} value={c.id}>{contactLabel(c)}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem" }}>
        <Field label="Case type">
          <input value={caseType} onChange={(e) => setCaseType(e.target.value)} placeholder="e.g. Electrical — appliance" />
        </Field>
        <Field label="Incident location">
          <input value={incidentLocation} onChange={(e) => setIncidentLocation(e.target.value)} />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem" }}>
        <Field label="Incident date">
          <input type="date" value={incidentDate ?? ""} onChange={(e) => setIncidentDate(e.target.value)} />
        </Field>
        <Field label="Opened on">
          <input type="date" value={openedOn ?? ""} onChange={(e) => setOpenedOn(e.target.value)} />
        </Field>
        <Field label="Closed on">
          <input type="date" value={closedOn ?? ""} onChange={(e) => setClosedOn(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </Field>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button className="btn" disabled={busy} onClick={submit}>
          {mode === "edit" ? "Save case" : "Create case"}
        </button>
        {onCancel ? (
          <button className="btn ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ContactForm({
  accounts,
  busy,
  mode,
  initial,
  onCancel,
  onSubmit,
}: {
  accounts: Account[];
  busy: boolean;
  mode: "create" | "edit";
  initial?: Contact;
  onCancel?: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  // WAL-593: see OpportunityForm above — the call site remounts this form
  // with `key={initial.id}` on record change instead of resyncing via effect.
  const [firstName, setFirstName] = useState(initial?.first_name ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [titleField, setTitleField] = useState(initial?.title ?? "");
  const [accountId, setAccountId] = useState(initial?.account_id ?? "");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = () => {
    if (!firstName.trim() && !lastName.trim() && !email.trim()) {
      setLocalErr("Provide at least a name or email.");
      return;
    }
    setLocalErr(null);
    void onSubmit({
      ...(mode === "edit"
        ? {
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            email: email.trim() || null,
            phone: phone.trim() || null,
            title: titleField.trim() || null,
            account_id: accountId || null,
          }
        : {
            ...(firstName.trim() ? { first_name: firstName.trim() } : {}),
            ...(lastName.trim() ? { last_name: lastName.trim() } : {}),
            ...(email.trim() ? { email: email.trim() } : {}),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(titleField.trim() ? { title: titleField.trim() } : {}),
            ...(accountId ? { account_id: accountId } : {}),
          }),
    });
  };

  return (
    <div className="panel pad" style={{ display: "grid", gap: "0.75rem", maxWidth: 720, marginBottom: "1rem" }}>
      <span className="eyebrow">{mode === "edit" ? "Edit contact" : "New contact"}</span>
      {localErr ? <p role="alert" className="form-msg error">{localErr}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem" }}>
        <Field label="First name">
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Last name">
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Title">
          <input value={titleField} onChange={(e) => setTitleField(e.target.value)} placeholder="e.g. Operations Manager" />
        </Field>
        <Field label="Account">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">—</option>
            {initial?.account_id && !accounts.some((a) => a.id === initial.account_id) ? (
              <option value={initial.account_id}>Current account</option>
            ) : null}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button className="btn" disabled={busy} onClick={submit}>
          {mode === "edit" ? "Save contact" : "Create contact"}
        </button>
        {onCancel ? (
          <button className="btn ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
