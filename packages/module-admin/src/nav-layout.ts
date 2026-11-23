import "server-only";

import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { NAV_LAYOUT_KEY, parseNavLayout, type NavLayout } from "./nav";

/** The client's saved sidebar layout. Any read failure falls back to defaults. */
export async function getNavLayout(): Promise<NavLayout | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("site_content")
      .select("value")
      .eq("key", NAV_LAYOUT_KEY)
      .maybeSingle();
    return error ? null : parseNavLayout(data?.value);
  } catch {
    return null;
  }
}
