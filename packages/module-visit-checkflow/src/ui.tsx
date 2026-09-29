"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { calcVisitStatus } from "./visit";
import type {
  ChecklistItem,
  PhotoRole,
  VisitSignoff,
  VisitStatus,
} from "./types";

export interface VisitViewProps {
  /** The inspection whose checklist + visit history this view signs off. */
  inspectionId: string;
  endpoint?: string;
  title?: string;
  intro?: string;
  setupRequired?: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type SubmitState =
  | { status: "idle"; message: string }
  | { status: "submitting"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

interface ItemState {
  item: ChecklistItem;
  done: boolean;
  note: string;
}

interface PendingPhoto {
  key: string;
  role: PhotoRole;
  file: File;
  previewUrl: string;
}

const STATUS_LABEL: Record<VisitStatus, string> = {
  complete: "Complete",
  partial: "Partial",
  issue: "Issue",
};

function statusBadgeClass(status: VisitStatus | null): string {
  if (status === "complete") return "badge in-stock";
  if (status === "partial") return "badge low-stock";
  return "badge out-of-stock";
}

function PhotoCapture({
  role,
  photos,
  onAdd,
  onRemove,
}: {
  role: PhotoRole;
  photos: PendingPhoto[];
  onAdd: (role: PhotoRole, files: FileList | null) => void;
  onRemove: (key: string) => void;
}) {
  const label = role === "before" ? "Before photos" : "After photos";
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <span className="label">{label}</span>
      <input
        className="input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        onChange={(e) => onAdd(role, e.currentTarget.files)}
      />
      {photos.length ? (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          {photos.map((p) => (
            <span key={p.key} style={{ position: "relative", display: "inline-block" }}>
              <img
                src={p.previewUrl}
                alt={`${role} preview`}
                style={{ width: 72, height: 72, objectFit: "cover", borderRadius: "var(--radius)" }}
              />
              <button
                type="button"
                className="btn ghost"
                onClick={() => onRemove(p.key)}
                aria-label="Remove photo"
                style={{ position: "absolute", top: -8, right: -8, padding: "0.1rem 0.4rem" }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * Per-visit checklist signoff. Loads an inspection's active checklist + items
 * and prior visits, lets the crew check off tasks, add notes + before/after
 * photos, and submit a signoff. The live status (complete/partial/issue) is
 * computed client-side with the same pure helper the server uses to persist it.
 */
export function VisitView({
  inspectionId,
  endpoint = "/api/visit",
  title = "Visit signoff",
  intro = "Work the checklist, capture photos, and submit the visit.",
  setupRequired = false,
}: VisitViewProps) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [items, setItems] = useState<ItemState[]>([]);
  const [checklistId, setChecklistId] = useState<string | null>(null);
  const [visits, setVisits] = useState<VisitSignoff[]>([]);
  const [signedBy, setSignedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [state, setState] = useState<SubmitState>({ status: "idle", message: "" });

  useEffect(() => {
    // Was one combined `if (setupRequired || !inspectionId) { setLoad(...); return; }`.
    // An audit (WAL-593) found the two conditions behave differently: when
    // setupRequired is true the component early-returns the setup callout
    // below before `load` is ever read, so that write was dead — dropped
    // here. When only inspectionId is empty, render falls through to the
    // main return, which does read `load.status`; that write is live, and
    // is replaced below by `effectiveLoad`, computed at render instead of
    // stored, so nothing needs to be set here at all.
    if (setupRequired || !inspectionId) return;
    let cancelled = false;
    async function loadChecklist() {
      try {
        const res = await fetch(
          `${endpoint}?inspectionId=${encodeURIComponent(inspectionId)}&generate=1`,
          { headers: { Accept: "application/json" } },
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          checklist?: { id?: string } | null;
          items?: ChecklistItem[];
          visits?: VisitSignoff[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setLoad({ status: "error", message: data.error ?? "Could not load the checklist." });
          return;
        }
        setChecklistId(data.checklist?.id ?? null);
        setItems(
          (data.items ?? [])
            .filter((i) => i.active !== false)
            .map((item) => ({ item, done: false, note: "" })),
        );
        setVisits(data.visits ?? []);
        setLoad({ status: "ready" });
      } catch (error) {
        if (cancelled) return;
        setLoad({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load the checklist.",
        });
      }
    }
    void loadChecklist();
    return () => {
      cancelled = true;
    };
  }, [endpoint, inspectionId, setupRequired]);

  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, [photos]);

  const liveStatus = useMemo(
    () => calcVisitStatus(items.map((i) => ({ done: i.done, active: true }))),
    [items],
  );

  // When there is no inspectionId, the fetch effect above never runs, so
  // `load` would otherwise sit at its initial "loading" state forever.
  // Deriving "ready" here at render time (rather than setting it in the
  // effect) means the empty-inspectionId case never calls setState.
  const effectiveLoad: LoadState = !inspectionId ? { status: "ready" } : load;

  function toggleItem(index: number, done: boolean) {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, done } : row)));
  }

  function setItemNote(index: number, note: string) {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, note } : row)));
  }

  function addPhotos(role: PhotoRole, files: FileList | null) {
    if (!files) return;
    const next: PendingPhoto[] = Array.from(files)
      .slice(0, 8)
      .map((file) => ({
        key: crypto.randomUUID(),
        role,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    setPhotos((prev) => [...prev, ...next]);
  }

  function removePhoto(key: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }

  async function uploadPhotos(visitId: string) {
    for (const photo of photos) {
      const form = new FormData();
      form.set("visit_id", visitId);
      form.set("role", photo.role);
      form.set("file", photo.file);
      // Best-effort: a photo failure (e.g. Storage not provisioned) must not
      // fail the already-recorded visit.
      await fetch(`${endpoint}?action=visit-photo-upload`, {
        method: "POST",
        body: form,
      }).catch(() => undefined);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting", message: "Saving…" });

    const payload = {
      inspection_id: inspectionId,
      checklist_id: checklistId,
      signed_by: signedBy || null,
      notes: notes || null,
      submission_id: crypto.randomUUID(),
      items: items.map((row) => ({
        checklist_item_id: row.item.id,
        done: row.done,
        note: row.note || null,
        active: true,
      })),
    };

    try {
      const res = await fetch(`${endpoint}?action=visit-signoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        visit?: VisitSignoff;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.id) {
        setState({ status: "error", message: data.error ?? "Could not save the visit." });
        return;
      }
      if (photos.length) await uploadPhotos(data.id);
      if (data.visit) setVisits((prev) => [data.visit as VisitSignoff, ...prev]);
      setState({ status: "success", message: "Visit signed off." });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not save the visit.",
      });
    }
  }

  if (setupRequired) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Visit checkflow</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Setup required.</strong> Visit signoffs are not yet configured
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
          <span className="eyebrow">Visit checkflow</span>
          <h1>{title}</h1>
          <p className="lede">{intro}</p>
        </header>

        {effectiveLoad.status === "loading" ? <p className="price-note">Loading checklist…</p> : null}
        {effectiveLoad.status === "error" ? (
          <div className="callout">
            <strong>Could not load the checklist.</strong> {effectiveLoad.message}
          </div>
        ) : null}

        {effectiveLoad.status === "ready" ? (
          <div className="catalog-layout">
            <form onSubmit={onSubmit} className="form">
              <div className="tabs" role="status" style={{ justifyContent: "space-between" }}>
                <strong>Checklist</strong>
                <span className={statusBadgeClass(liveStatus.status)}>
                  {STATUS_LABEL[liveStatus.status]} · {liveStatus.tasksDone}/{liveStatus.tasksTotal}
                </span>
              </div>

              {items.length === 0 ? (
                <div className="callout tint">
                  No checklist items yet for this inspection.
                </div>
              ) : (
                <div className="order-list">
                  {items.map((row, index) => (
                    <div
                      key={row.item.id}
                      className="order-row"
                      style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}
                    >
                      <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={row.done}
                          onChange={(e) => toggleItem(index, e.currentTarget.checked)}
                        />
                        <span style={{ flex: 1 }}>
                          <strong style={{ display: "block" }}>{row.item.task}</strong>
                          <span className="price-note" style={{ marginLeft: 0 }}>
                            {[row.item.area, row.item.frequency].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                      </label>
                      <input
                        className="input"
                        placeholder="Note (optional)"
                        value={row.note}
                        onChange={(e) => setItemNote(index, e.currentTarget.value)}
                      />
                    </div>
                  ))}
                </div>
              )}

              <PhotoCapture role="before" photos={photos.filter((p) => p.role === "before")} onAdd={addPhotos} onRemove={removePhoto} />
              <PhotoCapture role="after" photos={photos.filter((p) => p.role === "after")} onAdd={addPhotos} onRemove={removePhoto} />

              <div className="form-row">
                <label className="field">
                  <span className="label">Signed by</span>
                  <input
                    className="input"
                    value={signedBy}
                    onChange={(e) => setSignedBy(e.currentTarget.value)}
                    autoComplete="name"
                  />
                </label>
              </div>
              <label className="field">
                <span className="label">Visit notes</span>
                <textarea
                  className="input"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.currentTarget.value)}
                />
              </label>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                }}
              >
                <button type="submit" className="btn" disabled={state.status === "submitting"}>
                  {state.status === "submitting" ? "Saving…" : "Submit visit signoff"}
                </button>
                {state.message ? (
                  <p
                    role={state.status === "error" ? "alert" : "status"}
                    className={`form-msg ${state.status === "error" ? "error" : "success"}`}
                  >
                    {state.message}
                  </p>
                ) : null}
              </div>
            </form>

            <aside className="panel pad" aria-label="Visit history">
              <span className="eyebrow">Visit history</span>
              {visits.length === 0 ? (
                <p className="price-note" style={{ display: "block", marginTop: "0.75rem" }}>
                  No visits recorded yet.
                </p>
              ) : (
                <dl className="detail-dl" style={{ marginTop: "1rem" }}>
                  {visits.map((visit) => (
                    <span key={visit.id} style={{ display: "contents" }}>
                      <dt>{visit.visit_date ?? "—"}</dt>
                      <dd>
                        <span className={statusBadgeClass(visit.status)}>
                          {visit.status ? STATUS_LABEL[visit.status] : "—"}
                        </span>{" "}
                        {visit.tasks_done ?? 0}/{visit.tasks_total ?? 0}
                        {visit.signed_by ? ` · ${visit.signed_by}` : ""}
                      </dd>
                    </span>
                  ))}
                </dl>
              )}
            </aside>
          </div>
        ) : null}
      </section>
    </div>
  );
}
