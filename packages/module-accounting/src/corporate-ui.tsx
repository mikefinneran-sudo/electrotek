"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  CORPORATE_DOC_TYPES,
  CORPORATE_ENTITY_TYPES,
  FILING_FREQUENCIES,
  MAX_DOCUMENT_BYTES,
  REGISTRATION_KINDS,
  REGISTRATION_STATUSES,
  filingDueStatus,
} from "./corporate-logic";
import type {
  CorporateDocument,
  CorporateFiling,
  CorporateProfile,
  CorporateRegistration,
  CorporateSnapshot,
} from "./types";

const ENDPOINT = "/api/accounting/corporate";

type SetMessage = (value: string | null) => void;
type SetBusy = (value: boolean) => void;

/** Local calendar date: a UTC date flips to tomorrow on US evenings. */
function localIsoDate(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/** Text field from a form: blank becomes null so a cleared input clears the column. */
function field(data: FormData, name: string): string | null {
  const value = String(data.get(name) ?? "").trim();
  return value || null;
}

/** Parse a route response, tolerating a non-JSON platform error (413, 504). */
async function readResponse<T>(r: Response): Promise<T & { ok?: boolean; error?: string }> {
  const text = await r.text();
  let payload: (T & { ok?: boolean; error?: string }) | null = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!r.ok || !payload?.ok) {
    throw new Error(payload?.error ?? (r.status === 413 ? "File is too large." : `Request failed (${r.status}).`));
  }
  return payload;
}

async function postJson<T = unknown>(body: Record<string, unknown>) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<T>(r);
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost"
      style={{ marginLeft: "0.5rem", padding: "0.15rem 0.5rem", fontSize: "0.8rem" }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label ?? "Copy"}
    </button>
  );
}

function IdentifierRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <p style={{ margin: "0.35rem 0" }}>
      <span className="label">{label}</span>
      <code style={{ marginLeft: "0.5rem" }}>{value}</code>
      <CopyButton value={value} />
    </p>
  );
}

function TextRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <p style={{ margin: "0.35rem 0", whiteSpace: "pre-line" }}>
      <span className="label">{label}</span> {value}
    </p>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}

const cell = { padding: "0.5rem", verticalAlign: "top" } as const;
const headCell = { textAlign: "left", padding: "0.5rem" } as const;
const formGrid = { display: "grid", gap: "0.5rem", maxWidth: 640 } as const;

export interface CorporateInfoViewProps {
  title?: string;
  notAuthorized?: boolean;
  setupRequired?: boolean;
  loadError?: boolean;
  initial?: CorporateSnapshot;
}

export function CorporateInfoView({
  title = "Corporate info",
  notAuthorized,
  setupRequired,
  loadError,
  initial,
}: CorporateInfoViewProps) {
  const [snapshot, setSnapshot] = useState<CorporateSnapshot | undefined>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  const todayIso = useMemo(() => localIsoDate(), []);

  const reload = useCallback(async () => {
    const r = await fetch(ENDPOINT, { headers: { Accept: "application/json" } });
    const body = await readResponse<CorporateSnapshot>(r);
    setSnapshot({
      profile: body.profile,
      registrations: body.registrations ?? [],
      filings: body.filings ?? [],
      documents: body.documents ?? [],
    });
  }, []);

  /** Run one mutation with shared busy/message handling. */
  const run = useCallback(
    async (work: () => Promise<void>, success: string, failure: string) => {
      setBusy(true);
      setMessage(null);
      try {
        await work();
        setMessage(success);
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : failure);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const registrations = useMemo(() => snapshot?.registrations ?? [], [snapshot?.registrations]);
  const registrationsByJurisdiction = useMemo(() => {
    const map = new Map<string, CorporateRegistration[]>();
    for (const row of registrations) {
      const list = map.get(row.jurisdiction) ?? [];
      list.push(row);
      map.set(row.jurisdiction, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [registrations]);

  if (notAuthorized || setupRequired || loadError) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Accounting</span>
            <h1>{title}</h1>
          </header>
          {notAuthorized ? (
            <div className="callout warn">
              <strong>Not authorized.</strong> You do not have access to corporate info.
            </div>
          ) : (
            <div className="callout">
              <strong>{setupRequired ? "Setup required." : "Could not load."}</strong>{" "}
              {setupRequired
                ? "Corporate info is not configured for this site."
                : "Try again or contact your administrator."}
            </div>
          )}
        </section>
      </div>
    );
  }

  const profile = snapshot?.profile ?? null;

  async function saveProfile(form: HTMLFormElement) {
    const data = new FormData(form);
    const dbaNames = String(data.get("dba_names") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Every key below has an input in ProfileFormFields, so a blank here is a
    // deliberate clear, never a field the form forgot to render.
    await run(
      async () => {
        const payload = await postJson<{ profile: CorporateProfile }>({
          action: "upsert-profile",
          legal_name: field(data, "legal_name"),
          dba_names: dbaNames,
          entity_type: field(data, "entity_type"),
          tax_classification: field(data, "tax_classification"),
          ein: field(data, "ein"),
          formation_state: field(data, "formation_state"),
          formation_date: field(data, "formation_date"),
          sos_entity_number: field(data, "sos_entity_number"),
          registered_agent_name: field(data, "registered_agent_name"),
          registered_agent_address: field(data, "registered_agent_address"),
          principal_address: field(data, "principal_address"),
          mailing_address: field(data, "mailing_address"),
          fiscal_year_end: field(data, "fiscal_year_end"),
          naics_code: field(data, "naics_code"),
          duns_or_uei: field(data, "duns_or_uei"),
          notes: field(data, "notes"),
        });
        setSnapshot((prev) => (prev ? { ...prev, profile: payload.profile } : prev));
        setEditingProfile(false);
      },
      "Profile saved.",
      "Could not save profile.",
    );
  }

  return (
    <div className="page">
      <section className="container">
        <header className="page-head">
          <span className="eyebrow">Accounting</span>
          <h1>{title}</h1>
          <p className="price-note">
            <Link href="/accounting">← Back to accounting</Link>
          </p>
        </header>

        {message ? (
          <div className="callout" style={{ marginBottom: "1rem" }}>
            {message}
          </div>
        ) : null}

        <div className="panel pad" style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="label">Company profile</span>
            <button type="button" className="btn ghost" onClick={() => setEditingProfile((v) => !v)}>
              {editingProfile ? "Cancel" : profile ? "Edit" : "Add profile"}
            </button>
          </div>

          {editingProfile ? (
            <form
              style={{ marginTop: "1rem" }}
              onSubmit={(event) => {
                event.preventDefault();
                void saveProfile(event.currentTarget);
              }}
            >
              <ProfileFormFields profile={profile} />
              <button type="submit" className="btn" disabled={busy} style={{ marginTop: "0.75rem" }}>
                Save profile
              </button>
            </form>
          ) : profile ? (
            <ProfileDetails profile={profile} />
          ) : (
            <p className="price-note" style={{ marginTop: "0.75rem" }}>No profile yet.</p>
          )}
        </div>

        <RegistrationsPanel
          groups={registrationsByJurisdiction}
          busy={busy}
          run={run}
          reload={reload}
        />

        <FilingsPanel
          filings={snapshot?.filings ?? []}
          registrations={registrations}
          todayIso={todayIso}
          busy={busy}
          run={run}
          reload={reload}
        />

        <DocumentsPanel
          documents={snapshot?.documents ?? []}
          registrations={registrations}
          busy={busy}
          run={run}
          reload={reload}
          setMessage={setMessage}
          setBusy={setBusy}
        />
      </section>
    </div>
  );
}

type Run = (work: () => Promise<void>, success: string, failure: string) => Promise<boolean>;

function ProfileDetails({ profile }: { profile: CorporateProfile }) {
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem" }}>{profile.legal_name ?? "Legal name not set"}</h2>
      {profile.dba_names.length > 0 ? <p className="price-note">DBA: {profile.dba_names.join(", ")}</p> : null}
      <IdentifierRow label="EIN" value={profile.ein} />
      <IdentifierRow label="SOS #" value={profile.sos_entity_number} />
      <IdentifierRow label="DUNS / UEI" value={profile.duns_or_uei} />
      <IdentifierRow label="NAICS" value={profile.naics_code} />
      <TextRow label="Entity" value={profile.entity_type ? humanize(profile.entity_type) : null} />
      <TextRow label="Tax classification" value={profile.tax_classification} />
      <TextRow
        label="Formed"
        value={
          [profile.formation_state, profile.formation_date].filter(Boolean).join(" · ") || null
        }
      />
      <TextRow label="Fiscal year end" value={profile.fiscal_year_end} />
      <TextRow
        label="Registered agent"
        value={[profile.registered_agent_name, profile.registered_agent_address].filter(Boolean).join("\n") || null}
      />
      <TextRow label="Principal address" value={profile.principal_address} />
      <TextRow label="Mailing address" value={profile.mailing_address} />
      <TextRow label="Notes" value={profile.notes} />
    </div>
  );
}

function ProfileFormFields({ profile }: { profile: CorporateProfile | null }) {
  return (
    <div style={formGrid}>
      <Field label="Legal name">
        <input name="legal_name" className="input" defaultValue={profile?.legal_name ?? ""} />
      </Field>
      <Field label="DBA names (comma-separated)">
        <input name="dba_names" className="input" defaultValue={profile?.dba_names?.join(", ") ?? ""} />
      </Field>
      <Field label="Entity type">
        <select name="entity_type" className="input" defaultValue={profile?.entity_type ?? ""}>
          <option value="">—</option>
          {CORPORATE_ENTITY_TYPES.map((value) => (
            <option key={value} value={value}>{humanize(value)}</option>
          ))}
        </select>
      </Field>
      <Field label="Tax classification">
        <input
          name="tax_classification"
          className="input"
          placeholder="e.g. S corporation (Form 2553)"
          defaultValue={profile?.tax_classification ?? ""}
        />
      </Field>
      <Field label="EIN (##-#######)">
        <input name="ein" className="input" defaultValue={profile?.ein ?? ""} />
      </Field>
      <Field label="Formation state (2-letter)">
        <input name="formation_state" className="input" maxLength={2} defaultValue={profile?.formation_state ?? ""} />
      </Field>
      <Field label="Formation date">
        <input name="formation_date" type="date" className="input" defaultValue={profile?.formation_date ?? ""} />
      </Field>
      <Field label="SOS entity number">
        <input name="sos_entity_number" className="input" defaultValue={profile?.sos_entity_number ?? ""} />
      </Field>
      <Field label="Fiscal year end (MM-DD)">
        <input name="fiscal_year_end" className="input" placeholder="12-31" defaultValue={profile?.fiscal_year_end ?? ""} />
      </Field>
      <Field label="NAICS code">
        <input name="naics_code" className="input" defaultValue={profile?.naics_code ?? ""} />
      </Field>
      <Field label="DUNS / UEI">
        <input name="duns_or_uei" className="input" defaultValue={profile?.duns_or_uei ?? ""} />
      </Field>
      <Field label="Registered agent name">
        <input name="registered_agent_name" className="input" defaultValue={profile?.registered_agent_name ?? ""} />
      </Field>
      <Field label="Registered agent address">
        <textarea
          name="registered_agent_address"
          className="input"
          rows={2}
          defaultValue={profile?.registered_agent_address ?? ""}
        />
      </Field>
      <Field label="Principal address">
        <textarea name="principal_address" className="input" rows={2} defaultValue={profile?.principal_address ?? ""} />
      </Field>
      <Field label="Mailing address">
        <textarea name="mailing_address" className="input" rows={2} defaultValue={profile?.mailing_address ?? ""} />
      </Field>
      <Field label="Notes">
        <textarea name="notes" className="input" rows={2} defaultValue={profile?.notes ?? ""} />
      </Field>
    </div>
  );
}

/** null = form closed, "new" = add form, otherwise the row being edited. */
type EditTarget<T> = null | "new" | T;

function RegistrationsPanel({
  groups,
  busy,
  run,
  reload,
}: {
  groups: [string, CorporateRegistration[]][];
  busy: boolean;
  run: Run;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<EditTarget<CorporateRegistration>>(null);
  const row = editing !== null && editing !== "new" ? editing : null;

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    const ok = await run(
      async () => {
        await postJson({
          action: "upsert-registration",
          id: row?.id,
          jurisdiction: String(data.get("jurisdiction") ?? ""),
          kind: String(data.get("kind") ?? ""),
          label: String(data.get("label") ?? ""),
          identifier: field(data, "identifier"),
          agency_name: field(data, "agency_name"),
          portal_url: field(data, "portal_url"),
          onepassword_ref: field(data, "onepassword_ref"),
          effective_date: field(data, "effective_date"),
          status: String(data.get("status") ?? ""),
          notes: field(data, "notes"),
        });
        await reload();
      },
      "Registration saved.",
      "Could not save registration.",
    );
    if (ok) setEditing(null);
  }

  async function remove(target: CorporateRegistration) {
    if (!window.confirm(`Delete registration "${target.label}"? Linked filings and documents are kept.`)) return;
    await run(
      async () => {
        await postJson({ action: "delete-registration", id: target.id });
        await reload();
      },
      "Registration deleted.",
      "Could not delete registration.",
    );
  }

  return (
    <div className="panel pad" style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className="label">Registrations and tax IDs</span>
        <button type="button" className="btn ghost" onClick={() => setEditing(editing ? null : "new")}>
          {editing ? "Cancel" : "Add registration"}
        </button>
      </div>

      {editing ? (
        <form
          key={row?.id ?? "new"}
          style={{ marginTop: "1rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            void save(e.currentTarget);
          }}
        >
          <div style={formGrid}>
            <Field label="Jurisdiction">
              <input name="jurisdiction" className="input" required placeholder="IN or US" defaultValue={row?.jurisdiction ?? ""} />
            </Field>
            <Field label="Kind">
              <select name="kind" className="input" defaultValue={row?.kind ?? "other"}>
                {REGISTRATION_KINDS.map((k) => (
                  <option key={k} value={k}>{humanize(k)}</option>
                ))}
              </select>
            </Field>
            <Field label="Label">
              <input name="label" className="input" required defaultValue={row?.label ?? ""} />
            </Field>
            <Field label="Account / ID number">
              <input name="identifier" className="input" defaultValue={row?.identifier ?? ""} />
            </Field>
            <Field label="Agency">
              <input name="agency_name" className="input" defaultValue={row?.agency_name ?? ""} />
            </Field>
            <Field label="Effective date">
              <input name="effective_date" type="date" className="input" defaultValue={row?.effective_date ?? ""} />
            </Field>
            <Field label="Portal URL">
              <input name="portal_url" className="input" type="url" defaultValue={row?.portal_url ?? ""} />
            </Field>
            <Field label="1Password reference (op://…) — the login stays in 1Password">
              <input name="onepassword_ref" className="input" placeholder="op://vault/item" defaultValue={row?.onepassword_ref ?? ""} />
            </Field>
            <Field label="Status">
              <select name="status" className="input" defaultValue={row?.status ?? "active"}>
                {REGISTRATION_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Notes">
              <textarea name="notes" className="input" rows={2} defaultValue={row?.notes ?? ""} />
            </Field>
          </div>
          <button type="submit" className="btn" disabled={busy} style={{ marginTop: "0.75rem" }}>
            {row ? "Save changes" : "Save registration"}
          </button>
        </form>
      ) : null}

      {groups.length === 0 ? (
        <p className="price-note" style={{ marginTop: "0.75rem" }}>No registrations yet.</p>
      ) : (
        groups.map(([jurisdiction, rows]) => (
          <div key={jurisdiction} style={{ marginTop: "1rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{jurisdiction}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr>
                  <th style={headCell}>Registration</th>
                  <th style={headCell}>ID</th>
                  <th style={headCell}>Access</th>
                  <th style={headCell} />
                </tr>
              </thead>
              <tbody>
                {rows.map((reg) => (
                  <tr key={reg.id}>
                    <td style={cell}>
                      {reg.label}
                      <span className="price-note" style={{ display: "block" }}>
                        {humanize(reg.kind)}
                        {reg.agency_name ? ` · ${reg.agency_name}` : ""}
                        {reg.status !== "active" ? ` · ${reg.status}` : ""}
                      </span>
                    </td>
                    <td style={cell}>
                      {reg.identifier ? (
                        <>
                          <code>{reg.identifier}</code>
                          <CopyButton value={reg.identifier} />
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={cell}>
                      {isHttpUrl(reg.portal_url) ? (
                        <a href={reg.portal_url} target="_blank" rel="noreferrer">Portal</a>
                      ) : null}
                      {reg.onepassword_ref ? (
                        // op:// is a 1Password CLI/SDK reference, not a browser link.
                        <span style={{ display: "block" }}>
                          <code style={{ fontSize: "0.8rem" }}>{reg.onepassword_ref}</code>
                          <CopyButton value={reg.onepassword_ref} />
                        </span>
                      ) : null}
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>
                      <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditing(reg)}>
                        Edit
                      </button>
                      <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove(reg)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

function RegistrationSelect({
  registrations,
  defaultValue,
}: {
  registrations: CorporateRegistration[];
  defaultValue: string | null | undefined;
}) {
  return (
    <select name="registration_id" className="input" defaultValue={defaultValue ?? ""}>
      <option value="">—</option>
      {registrations.map((reg) => (
        <option key={reg.id} value={reg.id}>
          {reg.jurisdiction} · {reg.label}
        </option>
      ))}
    </select>
  );
}

function FilingsPanel({
  filings,
  registrations,
  todayIso,
  busy,
  run,
  reload,
}: {
  filings: CorporateFiling[];
  registrations: CorporateRegistration[];
  todayIso: string;
  busy: boolean;
  run: Run;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<EditTarget<CorporateFiling>>(null);
  const row = editing !== null && editing !== "new" ? editing : null;

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    const ok = await run(
      async () => {
        await postJson({
          action: "upsert-filing",
          id: row?.id,
          registration_id: field(data, "registration_id"),
          jurisdiction: String(data.get("jurisdiction") ?? ""),
          name: String(data.get("name") ?? ""),
          frequency: String(data.get("frequency") ?? ""),
          next_due_date: field(data, "next_due_date"),
          last_filed_date: field(data, "last_filed_date"),
          last_confirmation: field(data, "last_confirmation"),
          portal_url: field(data, "portal_url"),
          notes: field(data, "notes"),
        });
        await reload();
      },
      "Filing saved.",
      "Could not save filing.",
    );
    if (ok) setEditing(null);
  }

  async function markFiled(filing: CorporateFiling) {
    const confirmation = window.prompt(`Mark "${filing.name}" filed today. Confirmation number (optional):`, "");
    if (confirmation === null) return;
    await run(
      async () => {
        await postJson({
          action: "mark-filed",
          id: filing.id,
          filed_date: todayIso,
          confirmation: confirmation.trim() || null,
        });
        await reload();
      },
      `Marked "${filing.name}" as filed.`,
      "Could not mark filed.",
    );
  }

  async function remove(target: CorporateFiling) {
    if (!window.confirm(`Delete filing "${target.name}"?`)) return;
    await run(
      async () => {
        await postJson({ action: "delete-filing", id: target.id });
        await reload();
      },
      "Filing deleted.",
      "Could not delete filing.",
    );
  }

  const sorted = [...filings].sort((a, b) => {
    if (!a.next_due_date && !b.next_due_date) return 0;
    if (!a.next_due_date) return 1;
    if (!b.next_due_date) return -1;
    return a.next_due_date.localeCompare(b.next_due_date);
  });

  return (
    <div className="panel pad" style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className="label">Filings</span>
        <button type="button" className="btn ghost" onClick={() => setEditing(editing ? null : "new")}>
          {editing ? "Cancel" : "Add filing"}
        </button>
      </div>

      {editing ? (
        <form
          key={row?.id ?? "new"}
          style={{ marginTop: "1rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            void save(e.currentTarget);
          }}
        >
          <div style={formGrid}>
            <Field label="Jurisdiction">
              <input name="jurisdiction" className="input" required defaultValue={row?.jurisdiction ?? ""} />
            </Field>
            <Field label="Name">
              <input name="name" className="input" required defaultValue={row?.name ?? ""} />
            </Field>
            <Field label="Registration">
              <RegistrationSelect registrations={registrations} defaultValue={row?.registration_id} />
            </Field>
            <Field label="Frequency">
              <select name="frequency" className="input" defaultValue={row?.frequency ?? "annual"}>
                {FILING_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{humanize(f)}</option>
                ))}
              </select>
            </Field>
            <Field label="Next due date">
              <input name="next_due_date" type="date" className="input" defaultValue={row?.next_due_date ?? ""} />
            </Field>
            <Field label="Last filed date">
              <input name="last_filed_date" type="date" className="input" defaultValue={row?.last_filed_date ?? ""} />
            </Field>
            <Field label="Last confirmation number">
              <input name="last_confirmation" className="input" defaultValue={row?.last_confirmation ?? ""} />
            </Field>
            <Field label="Portal URL">
              <input name="portal_url" className="input" type="url" defaultValue={row?.portal_url ?? ""} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" className="input" rows={2} defaultValue={row?.notes ?? ""} />
            </Field>
          </div>
          <button type="submit" className="btn" disabled={busy} style={{ marginTop: "0.75rem" }}>
            {row ? "Save changes" : "Save filing"}
          </button>
        </form>
      ) : null}

      {sorted.length === 0 ? (
        <p className="price-note" style={{ marginTop: "0.75rem" }}>No filings tracked yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", marginTop: "0.75rem" }}>
          <thead>
            <tr>
              <th style={headCell}>Filing</th>
              <th style={headCell}>Due</th>
              <th style={headCell}>Last filed</th>
              <th style={headCell} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((filing) => {
              const status = filingDueStatus(filing.next_due_date, todayIso);
              const tone =
                status === "overdue"
                  ? { color: "var(--warn, #b42318)" }
                  : status === "due_soon"
                    ? { color: "var(--accent, #b54708)" }
                    : undefined;
              return (
                <tr key={filing.id}>
                  <td style={cell}>
                    {isHttpUrl(filing.portal_url) ? (
                      <a href={filing.portal_url} target="_blank" rel="noreferrer">{filing.name}</a>
                    ) : (
                      filing.name
                    )}
                    <span className="price-note" style={{ display: "block" }}>
                      {filing.jurisdiction} · {humanize(filing.frequency)}
                    </span>
                  </td>
                  <td style={{ ...cell, ...tone }}>
                    {filing.next_due_date ?? "—"}
                    {status === "overdue" ? " (overdue)" : status === "due_soon" ? " (due soon)" : ""}
                  </td>
                  <td style={cell}>
                    {filing.last_filed_date ?? "—"}
                    {filing.last_confirmation ? (
                      <span className="price-note" style={{ display: "block" }}>
                        Conf. <code>{filing.last_confirmation}</code>
                      </span>
                    ) : null}
                  </td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    <button type="button" className="btn ghost" disabled={busy} onClick={() => void markFiled(filing)}>
                      Mark filed
                    </button>
                    <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditing(filing)}>
                      Edit
                    </button>
                    <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove(filing)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DocumentsPanel({
  documents,
  registrations,
  busy,
  run,
  reload,
  setMessage,
  setBusy,
}: {
  documents: CorporateDocument[];
  registrations: CorporateRegistration[];
  busy: boolean;
  run: Run;
  reload: () => Promise<void>;
  setMessage: SetMessage;
  setBusy: SetBusy;
}) {
  const maxMb = MAX_DOCUMENT_BYTES / (1024 * 1024);

  async function upload(form: HTMLFormElement) {
    const data = new FormData(form);
    const file = data.get("file");
    // Checked here because an oversized body is rejected by the platform
    // before the route can return a readable error.
    if (file instanceof File && file.size > MAX_DOCUMENT_BYTES) {
      setMessage(`File is larger than ${maxMb} MB.`);
      return;
    }
    if (!field(data, "registration_id")) data.delete("registration_id");
    data.set("action", "upload-document");
    await run(
      async () => {
        await readResponse(await fetch(ENDPOINT, { method: "POST", body: data }));
        form.reset();
        await reload();
      },
      "Document uploaded.",
      "Upload failed.",
    );
  }

  async function download(id: string) {
    // Open the tab inside the click so popup blockers allow it, then point it
    // at the short-lived signed URL.
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const r = await fetch(`${ENDPOINT}?resource=download&document_id=${encodeURIComponent(id)}`, {
        headers: { Accept: "application/json" },
      });
      const body = await readResponse<{ url: string }>(r);
      if (tab) {
        tab.opener = null;
        tab.location.href = body.url;
      } else {
        window.location.assign(body.url);
      }
    } catch (error) {
      tab?.close();
      setMessage(error instanceof Error ? error.message : "Could not download.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: CorporateDocument) {
    if (!window.confirm(`Delete "${doc.file_name}"? This removes the stored file.`)) return;
    await run(
      async () => {
        await postJson({ action: "delete-document", id: doc.id });
        await reload();
      },
      "Document deleted.",
      "Could not delete document.",
    );
  }

  const registrationLabel = (id: string | null) => {
    const reg = id ? registrations.find((r) => r.id === id) : undefined;
    return reg ? ` · ${reg.jurisdiction} ${reg.label}` : "";
  };

  return (
    <div className="panel pad">
      <span className="label">Documents</span>
      <form
        style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }}
        onSubmit={(e) => {
          e.preventDefault();
          void upload(e.currentTarget);
        }}
      >
        <Field label={`File (PDF or image, max ${maxMb} MB)`}>
          <input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" required />
        </Field>
        <Field label="Type">
          <select name="doc_type" className="input" defaultValue="other">
            {CORPORATE_DOC_TYPES.map((t) => (
              <option key={t} value={t}>{humanize(t)}</option>
            ))}
          </select>
        </Field>
        <Field label="Registration">
          <RegistrationSelect registrations={registrations} defaultValue={null} />
        </Field>
        <button type="submit" className="btn" disabled={busy}>Upload</button>
      </form>

      {documents.length === 0 ? (
        <p className="price-note" style={{ marginTop: "0.75rem" }}>No documents uploaded.</p>
      ) : (
        <ul style={{ marginTop: "0.75rem", paddingLeft: "1.25rem" }}>
          {documents.map((doc) => (
            <li key={doc.id} style={{ marginBottom: "0.35rem" }}>
              {doc.file_name}{" "}
              <span className="price-note">
                ({humanize(doc.doc_type)}
                {registrationLabel(doc.registration_id)})
              </span>{" "}
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void download(doc.id)}>
                Download
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove(doc)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
