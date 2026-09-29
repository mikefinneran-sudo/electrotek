"use client";

import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@waltersignal/bananaforce-data-supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <button type="button" className="btn ghost" onClick={() => void signOut()}>
      Sign out
    </button>
  );
}
