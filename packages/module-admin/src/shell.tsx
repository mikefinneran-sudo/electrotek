"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveNavLayout } from "./actions";
import { NAV_LABEL_MAX, type AdminNavItem } from "./nav";
import { SignOutButton } from "./sign-out";

export interface AdminShellProps {
  brandName: string;
  navItems: AdminNavItem[];
  staffEmail: string;
  staffName: string | null;
  staffRole: string;
  /** Where the brand links. Defaults to /admin; a client without module-admin passes its staffHome. */
  homeHref?: string;
  /** Admins may reorder and rename the sidebar in place. */
  canCustomize?: boolean;
  children: React.ReactNode;
}

type DraftItem = { href: string; label: string; defaultLabel: string };

export function AdminShell({
  brandName,
  navItems,
  staffEmail,
  staffName,
  staffRole,
  homeHref = "/admin",
  canCustomize = false,
  children,
}: AdminShellProps) {
  const pathname = usePathname();
  const [draft, setDraft] = useState<DraftItem[] | null>(null);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href={homeHref} className="admin-brand">
          {brandName}
          <span className="admin-brand-sub">Back office</span>
        </Link>
        {draft ? (
          <NavEditor draft={draft} setDraft={setDraft} />
        ) : (
          <nav className="admin-nav">
            {navItems.map((item) => {
              const active = "exact" in item && item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`admin-nav-link${active ? " active" : ""}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="admin-sidebar-foot">
          <span className="admin-user">
            {staffName || staffEmail}
            {staffRole === "admin" ? <span className="admin-role"> · admin</span> : null}
          </span>
          <div className="admin-foot-actions">
            <SignOutButton />
            {canCustomize && !draft ? (
              <button
                type="button"
                className="admin-text-btn"
                onClick={() =>
                  setDraft(
                    navItems.map((item) => ({
                      href: item.href,
                      label: item.label,
                      defaultLabel: item.defaultLabel ?? item.label,
                    })),
                  )
                }
              >
                Customize
              </button>
            ) : null}
          </div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-mobile-bar">
          <Link href={homeHref} className="admin-brand compact">
            {brandName}
          </Link>
          <SignOutButton />
        </header>
        <nav className="admin-mobile-nav">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="admin-nav-link">
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}

/** Customize mode: drag rows (or Alt+Up/Down) to reorder, type to rename. */
function NavEditor({
  draft,
  setDraft,
}: {
  draft: DraftItem[];
  setDraft: (next: DraftItem[] | null) => void;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLOListElement>(null);

  function move(href: string, to: number) {
    const from = draft.findIndex((item) => item.href === href);
    if (from < 0) return;
    const next = [...draft];
    const [item] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, item!);
    setDraft(next);
  }

  function save(layout: { order: string[]; labels: Record<string, string> }) {
    setError(null);
    startTransition(async () => {
      const result = await saveNavLayout(layout);
      if (result.error) setError(result.error);
      // Keep the exit inside the transition so the refreshed nav and the exit commit together.
      else startTransition(() => setDraft(null));
    });
  }

  function done() {
    save({
      order: draft.map((item) => item.href),
      labels: Object.fromEntries(
        draft
          .map((item) => [item.href, item.label.trim()] as const)
          .filter(([, label]) => label !== ""),
      ),
    });
  }


  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "Enter") {
      event.preventDefault();
      done();
    } else if (event.key === "Escape") {
      setDraft(null);
    } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const href = draft[index]!.href;
      const to = event.key === "ArrowUp" ? index - 1 : index + 2;
      if (to < 0 || to > draft.length) return;
      move(href, to);
      // Moving a focused node can drop focus; put the caret back on the same row.
      requestAnimationFrame(() =>
        listRef.current?.querySelector<HTMLInputElement>(`input[data-href="${href}"]`)?.focus(),
      );
    }
  }

  return (
    <div className="admin-nav admin-nav-editor">
      <ol
        ref={listRef}
        className="admin-nav-rows"
        onDragOver={(event) => {
          if (dragging && !pending) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (pending) return;
          if (dragging && dropAt != null) move(dragging, dropAt);
          setDragging(null);
          setDropAt(null);
        }}
        onPointerUp={() => setArmed(null)}
      >
        {draft.map((item, index) => {
          const marker =
            dropAt === index ? " drop-before" : dropAt === draft.length && index === draft.length - 1 ? " drop-after" : "";
          return (
            <li
              key={item.href}
              className={`admin-nav-row${dragging === item.href ? " dragging" : ""}${marker}`}
              draggable={!pending && armed === item.href}
              onDragStart={(event) => {
                if (pending) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.href);
                setDragging(item.href);
              }}
              onDragOver={(event) => {
                if (!dragging || pending) return;
                event.preventDefault();
                const box = event.currentTarget.getBoundingClientRect();
                setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1);
              }}
              onDragEnd={() => {
                setArmed(null);
                setDragging(null);
                setDropAt(null);
              }}
            >
              <span
                className="admin-nav-handle"
                aria-hidden="true"
                title="Drag to reorder (Alt + arrow keys also move)"
                onPointerDown={() => {
                  if (!pending) setArmed(item.href);
                }}
              >
                ⠿
              </span>
              <input
                className="admin-nav-input"
                data-href={item.href}
                value={item.label}
                placeholder={item.defaultLabel}
                maxLength={NAV_LABEL_MAX}
                aria-label={`Name for ${item.defaultLabel}. Alt plus arrow keys to move.`}
                disabled={pending}
                onChange={(event) =>
                  setDraft(
                    draft.map((row) =>
                      row.href === item.href ? { ...row, label: event.target.value } : row,
                    ),
                  )
                }
                onKeyDown={(event) => onKeyDown(event, index)}
              />
            </li>
          );
        })}
      </ol>
      {error ? (
        <p className="admin-nav-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="admin-nav-editor-actions">
        <button type="button" className="btn btn-sm" onClick={done} disabled={pending}>
          {pending ? "Saving…" : "Done"}
        </button>
        <button type="button" className="btn ghost btn-sm" onClick={() => setDraft(null)} disabled={pending}>
          Cancel
        </button>
      </div>
      <button
        type="button"
        className="admin-text-btn"
        disabled={pending}
        onClick={() => (confirmReset ? save({ order: [], labels: {} }) : setConfirmReset(true))}
        onBlur={() => setConfirmReset(false)}
      >
        {confirmReset ? "Confirm reset" : "Reset to default"}
      </button>
    </div>
  );
}
