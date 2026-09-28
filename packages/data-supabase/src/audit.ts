import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { warnSupabase } from "./server-helpers";

export interface AuditActor {
  actor_id?: string | null;
  actor_email?: string | null;
}

export interface AuditEvent extends AuditActor {
  action: string;
  resource_type: string;
  resource_id?: string | number | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Best-effort audit writer. Never throws: callers should record after the main
 * mutation and must not fail user-facing writes because audit_log is absent or
 * temporarily unavailable.
 */
export async function recordAudit(
  client: SupabaseClient | null | undefined,
  event: AuditEvent,
): Promise<void> {
  if (!client) return;

  try {
    const { error } = await client.from("audit_log").insert({
      actor_id: event.actor_id ?? null,
      actor_email: event.actor_email ?? null,
      action: event.action,
      resource_type: event.resource_type,
      resource_id:
        event.resource_id == null ? null : String(event.resource_id),
      before: event.before ?? null,
      after: event.after ?? null,
    });

    if (error) {
      warnSupabase("Audit", "recordAudit", error);
    }
  } catch (error) {
    warnSupabase("Audit", "recordAudit", error);
  }
}
