"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runGuardedLoad } from "@waltersignal/bananaforce-core";

// --- shared types mirroring the /api/sign GET payload --------------------

interface AgreementSection {
  title: string;
  text: string;
}

interface AgreementSummary {
  monthly: string;
  visitsLabel: string;
  targetStart: string;
}

interface SignAgreement {
  title: string;
  effectiveDate: string;
  summary: AgreementSummary;
  sections: AgreementSection[];
  provider: { legalName: string; shortName: string };
  customer: { company: string; address: string; representative: string };
}

interface SignLoadResponse {
  ok?: boolean;
  setupRequired?: boolean;
  error?: string;
  alreadySigned?: boolean;
  signedAt?: string | null;
  signerName?: string | null;
  company?: string | null;
  address?: string | null;
  agreement?: SignAgreement;
}

// --- signature pad -------------------------------------------------------

function useSignaturePad() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const point = useCallback((event: PointerEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Size the backing store to the displayed size for a crisp signature.
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0F0F11";

    const down = (e: PointerEvent) => {
      drawing.current = true;
      last.current = point(e, canvas);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drawing.current || !last.current) return;
      const p = point(e, canvas);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
      hasInk.current = true;
    };
    const up = () => {
      drawing.current = false;
      last.current = null;
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", up);
    };
  }, [point]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
  }, []);

  const toDataUrl = useCallback((): string | null => {
    if (!hasInk.current || !canvasRef.current) return null;
    return canvasRef.current.toDataURL("image/png");
  }, []);

  return { canvasRef, clear, toDataUrl };
}

// --- SignView (client) ---------------------------------------------------

export interface SignViewProps {
  /** Sign token from the link (?token=). */
  token: string;
  /** API base for the sign route. */
  endpoint?: string;
  brandName?: string;
}

type SignState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "signed"; pdfUrl: string };

export function SignView({ token, endpoint = "/api/sign", brandName }: SignViewProps) {
  const [load, setLoad] = useState<SignLoadResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<SignState>({ status: "idle" });
  const [formError, setFormError] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const { canvasRef, clear, toDataUrl } = useSignaturePad();

  const pdfUrl = `${endpoint}?token=${encodeURIComponent(token)}&pdf=1`;

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const res = await fetch(`${endpoint}?token=${encodeURIComponent(token)}`, {
          headers: { Accept: "application/json" },
        });
        const data = (await res.json().catch(() => ({}))) as SignLoadResponse;
        if (!active) return;
        if (!res.ok || !data.ok) {
          setLoadError(data.error ?? "This signing link is invalid or has expired.");
          return;
        }
        setLoad(data);
        if (data.alreadySigned) setState({ status: "signed", pdfUrl });
      } catch {
        if (active) setLoadError("Could not load the agreement. Please try again.");
      }
    }
    run();
    return () => {
      active = false;
    };
  }, [endpoint, token, pdfUrl]);

  async function onSubmit() {
    setFormError(null);
    if (!signerName.trim()) {
      setFormError("Please enter your printed name.");
      return;
    }
    const signatureData = toDataUrl();
    if (!signatureData) {
      setFormError("Please draw your signature in the box above.");
      return;
    }
    setState({ status: "submitting" });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          token,
          signerName: signerName.trim(),
          signerTitle: signerTitle.trim(),
          signatureData,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setFormError(data.error ?? "Could not record your signature. Please try again.");
        setState({ status: "idle" });
        return;
      }
      setState({ status: "signed", pdfUrl });
    } catch {
      setFormError("Could not record your signature. Please try again.");
      setState({ status: "idle" });
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">{brandName ?? "Agreement"}</span>
            <h1>Signing link unavailable</h1>
          </header>
          <div className="callout">{loadError}</div>
        </section>
      </div>
    );
  }

  if (state.status === "signed") {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">{brandName ?? "Agreement"}</span>
            <h1>Agreement signed</h1>
            <p className="lede">Thank you. Your executed copy is ready to download.</p>
          </header>
          <div className="actions" style={{ display: "flex", gap: "0.75rem" }}>
            <a className="btn" href={state.pdfUrl} target="_blank" rel="noreferrer">
              Download executed copy
            </a>
          </div>
        </section>
      </div>
    );
  }

  if (!load?.agreement) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <p className="lede">Loading your agreement…</p>
        </section>
      </div>
    );
  }

  const { agreement } = load;

  return (
    <div className="page">
      <section className="container" style={{ maxWidth: 860 }}>
        <header className="page-head">
          <span className="eyebrow">{agreement.provider.legalName}</span>
          <h1>Review &amp; sign your agreement</h1>
          <p className="lede">
            Please read the cleaning services agreement below. When ready, sign electronically at the
            bottom.
          </p>
        </header>

        <div className="panel pad">
          <dl className="detail-dl">
            <dt>Company</dt>
            <dd>{load.company ?? agreement.customer.company}</dd>
            <dt>Service location</dt>
            <dd>{load.address ?? agreement.customer.address}</dd>
            <dt>Monthly service</dt>
            <dd>{agreement.summary.monthly}</dd>
            <dt>Frequency</dt>
            <dd>{agreement.summary.visitsLabel}</dd>
          </dl>

          <ol className="agreement-sections" style={{ marginTop: "1.5rem", display: "grid", gap: "1rem" }}>
            {agreement.sections.map((sec) => (
              <li key={sec.title}>
                <strong style={{ display: "block" }}>{sec.title}</strong>
                <span style={{ whiteSpace: "pre-wrap" }}>{sec.text}</span>
              </li>
            ))}
          </ol>

          <div className="callout tint" style={{ marginTop: "1.5rem" }}>
            <strong>Your signature</strong>
            <p className="price-note" style={{ marginLeft: 0 }}>
              By signing, you agree to the terms above. You can download a fully executed PDF when
              finished.
            </p>
            <div className="form-row" style={{ marginTop: "0.75rem" }}>
              <label className="field">
                <span className="label">Print name *</span>
                <input
                  className="input"
                  value={signerName}
                  autoComplete="name"
                  onChange={(e) => setSignerName(e.currentTarget.value)}
                />
              </label>
              <label className="field">
                <span className="label">Title</span>
                <input
                  className="input"
                  value={signerTitle}
                  placeholder="Office Manager"
                  onChange={(e) => setSignerTitle(e.currentTarget.value)}
                />
              </label>
            </div>
            <label className="field">
              <span className="label">Signature *</span>
              <canvas
                ref={canvasRef}
                aria-label="Draw your signature"
                style={{
                  width: "100%",
                  height: 140,
                  border: "1px solid var(--warm-border, #E5DFD4)",
                  borderRadius: "var(--radius, 8px)",
                  background: "#fff",
                  touchAction: "none",
                }}
              />
            </label>
            <div className="actions" style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
              <button type="button" className="btn ghost" onClick={clear}>
                Clear
              </button>
              <button
                type="button"
                className="btn"
                onClick={onSubmit}
                disabled={state.status === "submitting"}
              >
                {state.status === "submitting" ? "Signing…" : "Sign agreement"}
              </button>
            </div>
            {formError ? (
              <p role="alert" className="form-msg error" style={{ marginTop: "0.75rem" }}>
                {formError}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

// --- ContractView (staff) ------------------------------------------------

export interface ContractRow {
  id: string;
  inspection_id: string;
  status: string;
  signer_name: string | null;
  signed_at: string | null;
}

export interface ContractViewProps {
  endpoint?: string;
  title?: string;
  setupRequired?: boolean;
}

/**
 * Pure fetch-and-return. Extracted to module scope (WAL-594) so the
 * stale-response guard can be exercised in tests without a React renderer —
 * this repo has no React testing library.
 */
export async function fetchContracts(endpoint: string): Promise<ContractRow[]> {
  const res = await fetch(endpoint, { headers: { Accept: "application/json" } });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; contracts?: ContractRow[] };
  if (data.ok && Array.isArray(data.contracts)) return data.contracts;
  throw new Error("Could not load contracts.");
}

/**
 * Staff view: lists contracts and mints a client sign link for an inspection.
 * Auth is enforced server-side by the route's authorize callback; this view just
 * calls the API and renders results.
 */
export function ContractView({
  endpoint = "/api/contract",
  title = "Contracts",
  setupRequired = false,
}: ContractViewProps) {
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [inspectionId, setInspectionId] = useState("");
  const [signUrl, setSignUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // `fetchContracts` does not set state itself, so both callers (the
  // initial-load effect below, guarded against a stale response, and
  // `mintLink`'s post-mint refresh) decide how to route the result.
  const loadContracts = useCallback(() => fetchContracts(endpoint), [endpoint]);

  useEffect(() => {
    if (setupRequired) return;
    return runGuardedLoad(
      loadContracts,
      (loadedContracts) => setContracts(loadedContracts),
      () => {
        /* non-fatal: list stays as-is */
      },
      "Could not load contracts.",
    );
  }, [loadContracts, setupRequired]);

  async function mintLink() {
    setMessage(null);
    setSignUrl(null);
    if (!inspectionId.trim()) {
      setMessage("Enter an inspection id to issue a sign link.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ inspectionId: inspectionId.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        signUrl?: string;
      };
      if (!res.ok || !data.ok) {
        setMessage(data.error ?? "Could not issue a sign link.");
        return;
      }
      setSignUrl(data.signUrl ?? null);
      setMessage("Sign link ready — share it with the client.");
      fetchContracts(endpoint)
        .then(setContracts)
        .catch(() => {
          /* non-fatal: list stays as-is */
        });
    } catch {
      setMessage("Could not issue a sign link.");
    } finally {
      setLoading(false);
    }
  }

  if (setupRequired) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">Contracts</span>
            <h1>{title}</h1>
          </header>
          <div className="callout">
            <strong>Setup required.</strong> Contracts are not yet configured for this site. Contact
            your administrator.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="container">
        <header className="page-head">
          <span className="eyebrow">Contracts</span>
          <h1>{title}</h1>
          <p className="lede">Issue a client sign link for an accepted inspection, then track status.</p>
        </header>

        <div className="panel pad form">
          <div className="form-row">
            <label className="field" style={{ flex: 1 }}>
              <span className="label">Inspection id</span>
              <input
                className="input"
                value={inspectionId}
                placeholder="inspection UUID"
                onChange={(e) => setInspectionId(e.currentTarget.value)}
              />
            </label>
            <button type="button" className="btn" onClick={mintLink} disabled={loading}>
              {loading ? "Working…" : "Issue sign link"}
            </button>
          </div>
          {message ? (
            <p className="form-msg" style={{ marginLeft: 0 }}>
              {message}{" "}
              {signUrl ? (
                <a className="inline-link" href={signUrl} target="_blank" rel="noreferrer">
                  Open sign link
                </a>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="panel pad" style={{ marginTop: "1.5rem" }}>
          <span className="eyebrow">All contracts</span>
          {contracts.length === 0 ? (
            <p className="price-note" style={{ marginLeft: 0 }}>
              No contracts yet.
            </p>
          ) : (
            <ul className="order-list" style={{ marginTop: "0.75rem" }}>
              {contracts.map((c) => (
                <li key={c.id} className="order-row">
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: "block" }}>{c.signer_name ?? "Unsigned"}</strong>
                    <span className="price-note" style={{ marginLeft: 0 }}>
                      Inspection {c.inspection_id.slice(0, 8)} ·{" "}
                      {c.signed_at ? `Signed ${c.signed_at.slice(0, 10)}` : "Awaiting signature"}
                    </span>
                  </span>
                  <span className="badge">{c.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
