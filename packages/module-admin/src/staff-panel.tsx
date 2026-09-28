"use client";

import { useActionState } from "react";
import { provisionStaff, removeStaffAction, setStaffRoleAction } from "./actions";

export function StaffPanel({
  currentUserId,
  isAdmin,
  rows,
}: {
  currentUserId: string;
  isAdmin: boolean;
  rows: { id: string; email: string; name: string | null; role: string }[];
}) {
  const [state, formAction, pending] = useActionState(provisionStaff, null);

  return (
    <div>
      <header className="page-head">
        <h1>Staff</h1>
        <p className="lede">Back-office users and roles.</p>
      </header>

      {isAdmin ? (
        <form action={formAction} className="panel pad form" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Provision staff</h2>
          <label className="field">
            <span className="label">Email</span>
            <input className="input" name="email" type="email" required />
          </label>
          <label className="field">
            <span className="label">Name</span>
            <input className="input" name="name" />
          </label>
          <label className="field">
            <span className="label">Temp password</span>
            <input className="input" name="password" type="password" required minLength={8} />
          </label>
          <label className="field">
            <span className="label">Role</span>
            <select className="input" name="role" defaultValue="staff">
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {state?.error ? <p className="form-msg error">{state.error}</p> : null}
          {state?.notice ? <p className="form-msg">{state.notice}</p> : null}
          {state?.ok ? <p className="form-msg success">Staff saved.</p> : null}
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Saving…" : "Add staff"}
          </button>
        </form>
      ) : null}

      <div className="order-list" style={{ marginTop: "1.5rem" }}>
        {rows.map((row) => (
          <div key={row.id} className="order-row" style={{ flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>{row.name || row.email}</strong>
              <div className="price-note">
                {row.email} · {row.role}
              </div>
            </div>
            {isAdmin && row.id !== currentUserId ? (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <form action={setStaffRoleAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="role" value={row.role === "admin" ? "staff" : "admin"} />
                  <button type="submit" className="btn ghost">
                    Make {row.role === "admin" ? "staff" : "admin"}
                  </button>
                </form>
                <form action={removeStaffAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <button type="submit" className="btn ghost">
                    Remove
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
