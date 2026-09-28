import "server-only";

import { randomUUID } from "node:crypto";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import {
  LEAD_ATTACHMENT_BUCKET,
  type LeadAttachmentRecord,
  type LeadCaptureRecord,
  type LeadCaptureResult,
} from "./index";
import { validateLeadAttachments } from "./validation";

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  status?: number | string;
  statusCode?: number | string;
};

function rpcParameters(lead: LeadCaptureRecord) {
  return {
    p_name: lead.name,
    p_email: lead.email,
    p_company: lead.company || null,
    p_source: lead.source ?? null,
    p_phone: lead.phone || null,
    p_office: lead.office || null,
    p_notes: lead.notes || null,
    p_ip_hash: lead.ipHash ?? null,
    p_user_agent: lead.userAgent ?? null,
    p_metadata: lead.metadata ?? {},
  };
}

function safeFileName(fileName: string): string {
  const safe = fileName
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return safe || "attachment";
}

export function isMissingLeadAttachmentBucket(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as SupabaseErrorLike;
  const status = String(candidate.statusCode ?? candidate.status ?? "");
  const message = String(candidate.message ?? "");
  return (
    status === "404" ||
    /bucket[^.]*not found|not found[^.]*bucket|resource was not found/i.test(message)
  );
}

function isMissingAttachmentSchema(error: SupabaseErrorLike): boolean {
  return (
    candidateCode(error) === "PGRST202" ||
    candidateCode(error) === "42P01" ||
    /submit_lead_with_attachments|lead_attachments/i.test(error.message ?? "")
  );
}

function candidateCode(error: SupabaseErrorLike): string {
  return String(error.code ?? "").toUpperCase();
}

export async function insertLead(
  lead: LeadCaptureRecord,
  files: readonly File[] = [],
): Promise<LeadCaptureResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      setupRequired: true,
      error: "Lead capture is not configured. Contact your administrator.",
    };
  }

  const supabase = await getSupabaseServerClient();
  if (files.length > 0) {
    const validation = validateLeadAttachments(files);
    if (!validation.ok) {
      return { ok: false, error: validation.errors[0] ?? "Attachment is invalid" };
    }

    const submissionPath = randomUUID();
    const attachments: LeadAttachmentRecord[] = [];
    const bucket = supabase.storage.from(LEAD_ATTACHMENT_BUCKET);

    for (const [index, file] of validation.files.entries()) {
      const storagePath = `${submissionPath}/${index + 1}-${randomUUID()}-${safeFileName(
        file.name,
      )}`;
      let bytes: ArrayBuffer;
      try {
        bytes = await file.arrayBuffer();
      } catch {
        return { ok: false, error: `${file.name || "Attachment"}: could not be read` };
      }

      let uploadError: SupabaseErrorLike | null = null;
      try {
        const result = await bucket.upload(storagePath, bytes, {
          contentType: file.type.toLowerCase(),
          upsert: false,
        });
        uploadError = result.error;
      } catch (error) {
        uploadError =
          error && typeof error === "object"
            ? (error as SupabaseErrorLike)
            : { message: String(error) };
      }
      if (uploadError) {
        if (isMissingLeadAttachmentBucket(uploadError)) {
          return {
            ok: false,
            setupRequired: true,
            error: "Lead attachment storage is not configured. Contact your administrator.",
          };
        }
        return {
          ok: false,
          error: `Attachment upload failed: ${uploadError.message ?? "Unknown error"}`,
        };
      }

      attachments.push({
        storagePath,
        fileName: file.name.slice(0, 255) || "attachment",
        mimeType: file.type.toLowerCase(),
        sizeBytes: file.size,
      });
    }

    // The attachment-aware RPC creates the lead and its attachment rows in one
    // database transaction after every object is safely present in Storage.
    const { data, error } = await supabase.rpc("submit_lead_with_attachments", {
      ...rpcParameters(lead),
      p_attachments: attachments.map((attachment) => ({
        storage_path: attachment.storagePath,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
      })),
    });

    if (error) {
      return {
        ok: false,
        ...(isMissingAttachmentSchema(error) ? { setupRequired: true } : {}),
        error: error.message,
      };
    }

    return {
      ok: true,
      ...(typeof data === "string" ? { leadId: data } : {}),
      attachments,
    };
  }

  // Insert via the SECURITY DEFINER RPC (WAL-389): anon no longer has a direct
  // INSERT grant on public.leads, so server-side validation always runs.
  const { error } = await supabase.rpc("submit_lead", rpcParameters(lead));

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

// Staff download links are minted at RENDER time, never persisted: a signed URL
// stored at insert time would already be dead by the time staff opened the lead.
const ATTACHMENT_SIGNED_URL_TTL = 60 * 10;

type LeadAttachmentRow = {
  id: string;
  lead_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

/**
 * Staff-facing: attachments for a whole page of leads, keyed by lead id, each
 * carrying a short-lived signed download URL. One row query plus one batched
 * sign call — never one round trip per lead. Runs on the ordinary session
 * client; RLS (`lead_capture_staff_reads_attachment*`) is what grants the read,
 * so this path needs no service-role key. Returns an empty map rather than
 * throwing when the migration is absent or the read is denied, and leaves
 * `downloadUrl` unset for any single file that fails to sign so the lead still
 * lists it by name.
 */
export async function fetchLeadAttachmentsByLead(
  leadIds: readonly string[],
): Promise<Map<string, LeadAttachmentRecord[]>> {
  const byLead = new Map<string, LeadAttachmentRecord[]>();
  if (leadIds.length === 0 || !isSupabaseConfigured()) return byLead;

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_attachments")
    .select("id,lead_id,storage_path,file_name,mime_type,size_bytes,created_at")
    .in("lead_id", [...leadIds])
    .order("created_at", { ascending: true });

  if (error || !data) return byLead;
  const rows = data as LeadAttachmentRow[];
  if (rows.length === 0) return byLead;

  let signedUrls: (string | null)[] = rows.map(() => null);
  try {
    const signed = await supabase.storage
      .from(LEAD_ATTACHMENT_BUCKET)
      .createSignedUrls(
        rows.map((row) => row.storage_path),
        ATTACHMENT_SIGNED_URL_TTL,
      );
    if (signed.data) {
      // Results come back positionally; a per-file `error` leaves signedUrl null.
      signedUrls = rows.map((_row, index) => signed.data?.[index]?.signedUrl ?? null);
    }
  } catch {
    // Storage unreachable: every file still renders, just without a link.
  }

  rows.forEach((row, index) => {
    const record: LeadAttachmentRecord = {
      id: row.id,
      leadId: row.lead_id,
      storagePath: row.storage_path,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      createdAt: row.created_at,
      ...(signedUrls[index] ? { downloadUrl: signedUrls[index] as string } : {}),
    };
    const existing = byLead.get(row.lead_id);
    if (existing) existing.push(record);
    else byLead.set(row.lead_id, [record]);
  });

  return byLead;
}
