"use client";

import { useMemo, useState } from "react";
import { localDateString } from "./lifecycle";
import type {
  HolderOption,
  LicenseDocumentWithUrl,
  LicenseExpiryAlert,
  LicenseHolderType,
  LicenseRenewal,
  LicenseStatus,
  LicenseWithStatus,
} from "./types";

export interface ActionResult {
  ok: boolean;
  id?: string;
  errors?: string[];
}

type Action = (formData: FormData) => Promise<ActionResult>;

export interface HolderDirectory {
  staff: HolderOption[];
  assets: HolderOption[];
  /** The firm's legal name from the corporate profile; holds company licenses. */
  companyName: string | null;
}

export interface LicensesDashboardProps {
  title: string;
  licenses: LicenseWithStatus[];
  alerts: LicenseExpiryAlert[];
  holders: HolderDirectory;
  renewalsByLicenseId: Record<string, LicenseRenewal[]>;
  documentsByLicenseId: Record<string, LicenseDocumentWithUrl[]>;
  onCreateLicense: Action;
  onUpdateLicense: Action;
  onRecordRenewal: Action;
  onUploadDocument: Action;
  onDeleteDocument: Action;
}

const HOLDER_LABELS: Record<LicenseHolderType, string> = {
  staff: "Staff",
  company: "Company",
  asset: "Equipment",
};

const STATUS_LABELS: Record<LicenseStatus, string> = {
  active: "Active",
  renewal_due: "Renewal Due",
  expired: "Expired",
  perpetual: "No Expiry",
};

const STATUS_ORDER: LicenseStatus[] = ["expired", "renewal_due", "active", "perpetual"];

const DOCUMENT_LABELS = { card: "Card", certificate: "Certificate", coi: "COI" } as const;

function longDate(iso: string | null): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function holderName(license: LicenseWithStatus, holders: HolderDirectory): string {
  if (license.holder_type === "company") return holders.companyName ?? "The firm";
  const id = license.holder_type === "staff" ? license.staff_holder_id : license.asset_holder_id;
  const list = license.holder_type === "staff" ? holders.staff : holders.assets;
  return list.find((option) => option.id === id)?.label ?? "Removed";
}

function daysText(license: LicenseWithStatus): string {
  const days = license.days_until_expiry;
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "Expires today";
  return `${days} days left`;
}

function StatusBadge({ status }: { status: LicenseStatus }) {
  return <span className={`badge lic-${status}`}>{STATUS_LABELS[status]}</span>;
}

/** Runs a form action and tracks busy/errors; resets the form on success when asked. */
function useAction(action: Action, resetOnSuccess = true) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setErrors([]);
    setSaved(false);
    const result = await action(new FormData(form));
    setBusy(false);
    if (result.ok) {
      setSaved(true);
      if (resetOnSuccess) form.reset();
    }
    if (result.errors) setErrors(result.errors);
  }

  return { busy, errors, saved, onSubmit, setErrors };
}

function Messages({ errors, saved }: { errors: string[]; saved?: boolean }) {
  if (errors.length > 0) {
    return (
      <div role="alert" className="callout lic-error">
        {errors.map((error) => (
          <p key={error}>{error}</p>
        ))}
      </div>
    );
  }
  return saved ? (
    <p role="status" className="callout tint">
      Saved.
    </p>
  ) : null;
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? " lic-wide" : ""}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function HolderFields({
  holders,
  license,
}: {
  holders: HolderDirectory;
  license?: LicenseWithStatus;
}) {
  const [holderType, setHolderType] = useState<LicenseHolderType>(license?.holder_type ?? "staff");

  return (
    <>
      <Field label="Held By">
        <select
          className="input"
          name="holder_type"
          value={holderType}
          onChange={(event) => setHolderType(event.target.value as LicenseHolderType)}
        >
          <option value="staff">Staff member</option>
          <option value="company">The firm</option>
          <option value="asset">Equipment</option>
        </select>
      </Field>
      {holderType === "staff" ? (
        <Field label="Staff Member">
          <select
            className="input"
            name="staff_holder_id"
            defaultValue={license?.staff_holder_id ?? ""}
            required
          >
            <option value="">Choose a staff member</option>
            {holders.staff.map((option) => (
              <option value={option.id} key={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {holderType === "asset" ? (
        <Field label="Equipment">
          <select
            className="input"
            name="asset_holder_id"
            defaultValue={license?.asset_holder_id ?? ""}
            required
          >
            <option value="">
              {holders.assets.length === 0 ? "No equipment on file" : "Choose equipment"}
            </option>
            {holders.assets.map((option) => (
              <option value={option.id} key={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {holderType === "company" ? (
        <Field label="Company">
          <input className="input" value={holders.companyName ?? "The firm"} readOnly />
        </Field>
      ) : null}
      {holderType === "staff" ? (
        <Field label="CEU Hours Required">
          <input
            className="input"
            type="number"
            min="0"
            step="0.25"
            name="ceu_hours_required"
            defaultValue={license?.ceu_hours_required ?? ""}
          />
        </Field>
      ) : null}
    </>
  );
}

function LicenseFields({ holders, license }: { holders: HolderDirectory; license?: LicenseWithStatus }) {
  return (
    <div className="lic-form-grid">
      <Field label="License Name">
        <input className="input" name="license_name" defaultValue={license?.license_name} required />
      </Field>
      <Field label="Issuing Authority">
        <input
          className="input"
          name="issuing_authority"
          defaultValue={license?.issuing_authority}
          required
        />
      </Field>
      <Field label="Jurisdiction">
        <input className="input" name="jurisdiction" defaultValue={license?.jurisdiction ?? ""} />
      </Field>
      <Field label="License Number">
        <input className="input" name="license_number" defaultValue={license?.license_number ?? ""} />
      </Field>
      <HolderFields holders={holders} license={license} />
      <Field label="Issued">
        <input className="input" type="date" name="issued_date" defaultValue={license?.issued_date ?? ""} />
      </Field>
      <Field label="Expires">
        <input className="input" type="date" name="expiry_date" defaultValue={license?.expiry_date ?? ""} />
      </Field>
      <Field label="Renewal Window (Days)">
        <input
          className="input"
          type="number"
          min="0"
          step="1"
          name="renewal_window_days"
          defaultValue={license?.renewal_window_days ?? 60}
        />
      </Field>
      <Field label="Notes" wide>
        <textarea className="input" name="notes" rows={2} defaultValue={license?.notes ?? ""} />
      </Field>
    </div>
  );
}

function AddLicense({ holders, onCreateLicense }: { holders: HolderDirectory; onCreateLicense: Action }) {
  const { busy, errors, saved, onSubmit } = useAction(onCreateLicense);
  return (
    <details className="panel lic-add">
      <summary className="lic-add-summary">Add License</summary>
      <form onSubmit={onSubmit} className="lic-add-body">
        <Messages errors={errors} saved={saved} />
        <LicenseFields holders={holders} />
        <div className="lic-actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : "Add License"}
          </button>
        </div>
      </form>
    </details>
  );
}

function EditLicense({
  license,
  holders,
  onUpdateLicense,
}: {
  license: LicenseWithStatus;
  holders: HolderDirectory;
  onUpdateLicense: Action;
}) {
  const { busy, errors, saved, onSubmit } = useAction(onUpdateLicense, false);
  return (
    <details className="lic-section">
      <summary className="lic-section-summary">Edit License</summary>
      <form onSubmit={onSubmit}>
        <Messages errors={errors} saved={saved} />
        <input type="hidden" name="id" value={license.id} />
        <LicenseFields holders={holders} license={license} />
        <div className="lic-actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </details>
  );
}

function RecordRenewal({ license, onRecordRenewal }: { license: LicenseWithStatus; onRecordRenewal: Action }) {
  const { busy, errors, saved, onSubmit } = useAction(onRecordRenewal);
  return (
    <section className="lic-section">
      <h3>Record Renewal</h3>
      <form onSubmit={onSubmit}>
        <Messages errors={errors} saved={saved} />
        <input type="hidden" name="license_id" value={license.id} />
        <div className="lic-form-grid">
          <Field label="Renewed On">
            <input className="input" type="date" name="renewed_on" defaultValue={localDateString()} required />
          </Field>
          <Field label="New Expiry">
            <input
              className="input"
              type="date"
              name="new_expiry_date"
              min={license.expiry_date ?? undefined}
              required={license.expiry_date !== null}
            />
          </Field>
          {license.holder_type === "staff" ? (
            <Field label="CEU Hours Completed">
              <input className="input" type="number" min="0" step="0.25" name="ceu_hours_completed" />
            </Field>
          ) : null}
          <Field label="Notes" wide>
            <textarea className="input" name="renewal_notes" rows={2} />
          </Field>
        </div>
        <div className="lic-actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : "Record Renewal"}
          </button>
        </div>
      </form>
    </section>
  );
}

function RenewalHistory({ renewals }: { renewals: LicenseRenewal[] }) {
  return (
    <section className="lic-section">
      <h3>Renewal History</h3>
      {renewals.length === 0 ? (
        <p className="case-empty-list">No renewals recorded yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table lic-table">
            <thead>
              <tr>
                <th scope="col">Renewed</th>
                <th scope="col">Previous Expiry</th>
                <th scope="col">New Expiry</th>
                <th scope="col">CEU Hours</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {renewals.map((renewal) => (
                <tr key={renewal.id}>
                  <td className="lic-nowrap">{longDate(renewal.renewed_on)}</td>
                  <td className="lic-nowrap">{longDate(renewal.previous_expiry_date)}</td>
                  <td className="lic-nowrap">
                    {renewal.new_expiry_date ? longDate(renewal.new_expiry_date) : "No expiry"}
                  </td>
                  <td>{renewal.ceu_hours_completed ?? "—"}</td>
                  <td>{renewal.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Documents({
  license,
  renewals,
  documents,
  onUploadDocument,
  onDeleteDocument,
}: {
  license: LicenseWithStatus;
  renewals: LicenseRenewal[];
  documents: LicenseDocumentWithUrl[];
  onUploadDocument: Action;
  onDeleteDocument: Action;
}) {
  const { busy, errors, saved, onSubmit, setErrors } = useAction(onUploadDocument);

  async function remove(documentId: string, name: string) {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    const formData = new FormData();
    formData.set("document_id", documentId);
    const result = await onDeleteDocument(formData);
    if (result.errors) setErrors(result.errors);
  }

  return (
    <section className="lic-section">
      <h3>Documents</h3>
      <Messages errors={errors} saved={saved} />
      {documents.length === 0 ? (
        <p className="case-empty-list">No cards, certificates, or COIs on file.</p>
      ) : (
        <ul className="lic-docs">
          {documents.map((document) => {
            const name = document.original_filename ?? DOCUMENT_LABELS[document.document_kind];
            return (
              <li key={document.id}>
                <span className="badge">{DOCUMENT_LABELS[document.document_kind]}</span>
                {document.signed_url ? (
                  <a href={document.signed_url} target="_blank" rel="noreferrer" className="inline-link">
                    {name}
                  </a>
                ) : (
                  <span>{name}</span>
                )}
                <span className="lic-muted">{longDate(document.uploaded_at)}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => remove(document.id, name)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={onSubmit} className="lic-upload">
        <input type="hidden" name="license_id" value={license.id} />
        <Field label="Type">
          <select className="input" name="document_kind" defaultValue="certificate">
            <option value="card">Card</option>
            <option value="certificate">Certificate</option>
            <option value="coi">COI</option>
          </select>
        </Field>
        <Field label="For">
          <select className="input" name="renewal_id" defaultValue="">
            <option value="">Current license</option>
            {renewals.map((renewal) => (
              <option value={renewal.id} key={renewal.id}>
                Renewal of {longDate(renewal.renewed_on)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="File (PDF or Image, 10 MB Max)">
          <input
            className="input"
            type="file"
            name="document"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            required
          />
        </Field>
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>
    </section>
  );
}

function LicenseDetail({
  license,
  holders,
  renewals,
  documents,
  actions,
}: {
  license: LicenseWithStatus;
  holders: HolderDirectory;
  renewals: LicenseRenewal[];
  documents: LicenseDocumentWithUrl[];
  actions: Pick<LicensesDashboardProps, "onUpdateLicense" | "onRecordRenewal" | "onUploadDocument" | "onDeleteDocument">;
}) {
  const fields: [string, string][] = [
    ["Held By", `${holderName(license, holders)} (${HOLDER_LABELS[license.holder_type]})`],
    ["Issuing Authority", license.issuing_authority],
    ["Jurisdiction", license.jurisdiction ?? "—"],
    ["License Number", license.license_number ?? "—"],
    ["Issued", longDate(license.issued_date)],
    ["Expires", license.expiry_date ? longDate(license.expiry_date) : "No expiry"],
    ["Renewal Window", `${license.renewal_window_days} days`],
  ];
  if (license.holder_type === "staff") {
    fields.push(["CEU Hours Required", license.ceu_hours_required == null ? "—" : String(license.ceu_hours_required)]);
  }

  return (
    <section className="panel pad lic-detail" aria-label={license.license_name}>
      <header className="case-detail-head">
        <div className="case-detail-heading">
          <h2 className="case-detail-title">{license.license_name}</h2>
          <StatusBadge status={license.status} />
        </div>
        <div className="case-detail-sub">
          {daysText(license) || "Does not expire"} · status as of {longDate(license.status_as_of)}
        </div>
      </header>
      <dl className="case-field-grid">
        {fields.map(([label, value]) => (
          <div className="case-field" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {license.notes ? <p className="lic-notes">{license.notes}</p> : null}
      <EditLicense key={license.id} license={license} holders={holders} onUpdateLicense={actions.onUpdateLicense} />
      <RecordRenewal key={`renew-${license.id}`} license={license} onRecordRenewal={actions.onRecordRenewal} />
      <RenewalHistory renewals={renewals} />
      <Documents
        key={`docs-${license.id}`}
        license={license}
        renewals={renewals}
        documents={documents}
        onUploadDocument={actions.onUploadDocument}
        onDeleteDocument={actions.onDeleteDocument}
      />
    </section>
  );
}

export function LicensesDashboard({
  title,
  licenses,
  alerts,
  holders,
  renewalsByLicenseId,
  documentsByLicenseId,
  onCreateLicense,
  ...actions
}: LicensesDashboardProps) {
  const [holderFilter, setHolderFilter] = useState<LicenseHolderType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<LicenseStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(licenses[0]?.id ?? null);

  const counts = useMemo(() => {
    const byStatus: Record<LicenseStatus, number> = { active: 0, renewal_due: 0, expired: 0, perpetual: 0 };
    for (const license of licenses) byStatus[license.status] += 1;
    return byStatus;
  }, [licenses]);

  const filtered = useMemo(
    () =>
      licenses.filter(
        (license) =>
          (holderFilter === "all" || license.holder_type === holderFilter) &&
          (statusFilter === "all" || license.status === statusFilter),
      ),
    [holderFilter, licenses, statusFilter],
  );
  const selected = licenses.find((license) => license.id === selectedId) ?? filtered[0] ?? null;

  return (
    <main className="container lic-page">
      <header className="page-head">
        <span className="eyebrow">Compliance</span>
        <h1>{title}</h1>
        <p className="lede">
          Every license and certification the firm, its staff, and its equipment hold, with renewal
          dates and the documents that prove them.
        </p>
      </header>

      <dl className="lic-summary">
        {STATUS_ORDER.map((status) => (
          <div key={status} className={`lic-summary-item lic-summary-${status}`}>
            <dt>{STATUS_LABELS[status]}</dt>
            <dd>{counts[status]}</dd>
          </div>
        ))}
      </dl>

      {alerts.length > 0 ? (
        <section aria-label="License alerts" className="lic-alerts">
          {alerts.map((alert) => (
            <p key={alert.id} className={`callout lic-alert-${alert.severity}`}>
              <button type="button" className="lic-link" onClick={() => setSelectedId(alert.license_id)}>
                {alert.message}
              </button>
            </p>
          ))}
        </section>
      ) : null}

      <AddLicense holders={holders} onCreateLicense={onCreateLicense} />

      <div className="lic-toolbar">
        <nav className="tabs" aria-label="Filter by status">
          {(["all", ...STATUS_ORDER] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={`tab ${statusFilter === status ? "active" : ""}`}
              onClick={() => setStatusFilter(status)}
            >
              {status === "all" ? "All" : STATUS_LABELS[status]}
              <span className="tab-count">{status === "all" ? licenses.length : counts[status]}</span>
            </button>
          ))}
        </nav>
        <label className="field lic-holder-filter">
          <span className="sr-only">Held by</span>
          <select
            className="input"
            value={holderFilter}
            onChange={(event) => setHolderFilter(event.target.value as LicenseHolderType | "all")}
          >
            <option value="all">All holders</option>
            <option value="staff">Staff</option>
            <option value="company">Company</option>
            <option value="asset">Equipment</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="panel case-empty-list">
          {licenses.length === 0 ? "No licenses yet. Add the first one above." : "No licenses match these filters."}
        </p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table lic-table">
            <thead>
              <tr>
                <th scope="col">License</th>
                <th scope="col">Held By</th>
                <th scope="col">Authority</th>
                <th scope="col">Expires</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((license) => (
                <tr key={license.id} className={license.id === selected?.id ? "lic-selected" : undefined}>
                  <td>
                    <button type="button" className="lic-link" onClick={() => setSelectedId(license.id)}>
                      {license.license_name}
                    </button>
                    {license.license_number ? <span className="lic-sub">{license.license_number}</span> : null}
                  </td>
                  <td>
                    {holderName(license, holders)}
                    <span className="lic-sub">{HOLDER_LABELS[license.holder_type]}</span>
                  </td>
                  <td>
                    {license.issuing_authority}
                    {license.jurisdiction ? <span className="lic-sub">{license.jurisdiction}</span> : null}
                  </td>
                  <td className="lic-nowrap">{license.expiry_date ? longDate(license.expiry_date) : "—"}</td>
                  <td className="lic-nowrap">
                    <StatusBadge status={license.status} />
                    {daysText(license) ? <span className="lic-sub">{daysText(license)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <LicenseDetail
          key={selected.id}
          license={selected}
          holders={holders}
          renewals={renewalsByLicenseId[selected.id] ?? []}
          documents={documentsByLicenseId[selected.id] ?? []}
          actions={actions}
        />
      ) : null}
    </main>
  );
}
