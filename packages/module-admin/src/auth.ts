import "server-only";

import { redirect } from "next/navigation";
import {
  getSupabaseServerClient,
} from "@waltersignal/bananaforce-data-supabase/server";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";

export type StaffUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

/** Signed-in user on the staff allowlist, else null. */
export async function getStaffUser(): Promise<StaffUser | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;

  const { data } = await supabase
    .from("staff")
    .select("id, email, name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!data?.email) return null;
  return {
    id: String(data.id),
    email: String(data.email),
    name: data.name != null ? String(data.name) : null,
    role: String(data.role ?? "staff"),
  };
}

export async function getSignedInEmail(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

/** Gate a server component or action to staff. Redirects to login when missing. */
export async function requireStaff(): Promise<StaffUser> {
  const staff = await getStaffUser();
  if (!staff) redirect("/admin/login");
  return staff;
}

/** Route/page authorize: demo flag OR real staff session. */
export async function staffAuthorize(): Promise<boolean> {
  if (process.env.BANANAFORCE_DEMO_OPEN_API === "1") return true;
  const staff = await getStaffUser();
  return staff != null;
}
