"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@waltersignal/bananaforce-data-supabase/client";

type StaffLoginFormProps = {
  homeRoute: string;
  /**
   * Google Workspace domain to steer the account chooser to, when the OAuth
   * client's consent screen is External. A hint only -- `hd` is trivially
   * removed from the URL, so the callback re-checks it server-side.
   */
  googleWorkspaceDomain?: string;
};

export function StaffLoginForm({ homeRoute, googleWorkspaceDomain }: StaffLoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"password" | "google" | null>(null);
  const pending = pendingAction != null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPendingAction("password");
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      router.replace(homeRoute);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function onGoogleSignIn() {
    setError(null);
    setPendingAction("google");
    try {
      const supabase = getSupabaseBrowserClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin).toString();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
          ...(googleWorkspaceDomain
            ? { queryParams: { hd: googleWorkspaceDomain } }
            : {}),
        },
      });
      if (signInError) throw signInError;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign in failed.");
      setPendingAction(null);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <button
        type="button"
        className="btn ghost block"
        disabled={pending}
        onClick={onGoogleSignIn}
      >
        {pendingAction === "google" ? "Redirecting..." : "Sign in with Google"}
      </button>
      <label className="field">
        <span className="label">Email</span>
        <input
          className="input"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
      </label>
      <label className="field">
        <span className="label">Password</span>
        <input
          className="input"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
      </label>
      {error ? (
        <p className="form-msg error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn block" disabled={pending}>
        {pendingAction === "password" ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
