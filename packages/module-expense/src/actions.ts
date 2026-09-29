"use server";

import "server-only";
import { runAiTask } from "@waltersignal/bananaforce-ai/server";
import type { AiConfig, ReceiptImage } from "@waltersignal/bananaforce-ai";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { draftFromReceiptFields } from "./lifecycle";
import { createDraftExpense } from "./server";
import type { ExpenseDraftInput } from "./types";

const ALLOWED: Record<string, ReceiptImage["mediaType"]> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

const MAX_BYTES = 10 * 1024 * 1024;

const EMPTY_DRAFT: ExpenseDraftInput = {
  vendor: null,
  purchased_on: null,
  total: null,
  tax: null,
  currency: "usd",
  field_confidence: {},
};

export interface UploadResult {
  ok: boolean;
  id?: string;
  /** Shown prominently. A broken AI config must never look like a quiet no-op. */
  warning?: string;
  errors?: string[];
}

/**
 * Best-effort cleanup of the uploaded object when `createDraftExpense` fails
 * after the upload has already succeeded. Never throws and never replaces the
 * original error — a failed cleanup must not mask the real cause.
 */
async function removeUploadedReceipt(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  storagePath: string,
): Promise<void> {
  await supabase.storage
    .from("expense-receipts")
    .remove([storagePath])
    .catch(() => undefined);
}

export async function uploadReceiptAndDraft(
  file: File,
  aiConfig: AiConfig | undefined,
): Promise<UploadResult> {
  const mediaType = ALLOWED[file.type];
  if (!mediaType) {
    return { ok: false, errors: [`Unsupported file type "${file.type}".`] };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, errors: ["Receipt images must be 10 MB or smaller."] };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, errors: ["Supabase is not configured."] };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const storagePath = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}`;

  const supabase = await getSupabaseServerClient();
  const { error: uploadError } = await supabase.storage
    .from("expense-receipts")
    .upload(storagePath, bytes, { contentType: mediaType, upsert: false });
  if (uploadError) return { ok: false, errors: [uploadError.message] };

  const image: ReceiptImage = { data: bytes.toString("base64"), mediaType };
  const extraction = await runAiTask("extract_receipt_fields", image, aiConfig);

  // The receipt is stored either way. Only the prefill depends on the model.
  if (extraction.ok) {
    const result = await createDraftExpense(draftFromReceiptFields(extraction.fields), {
      storage_path: storagePath,
      media_type: mediaType,
      extracted_at: new Date().toISOString(),
    });
    if (!result.ok) await removeUploadedReceipt(supabase, storagePath);
    return result.ok ? { ok: true, id: result.id } : { ok: false, errors: result.errors };
  }

  // Absent: the client did not buy OCR. Silent — manual entry is the normal path.
  // extracted_at stays null: no attempt was made, and that must stay
  // distinguishable from "attempted, found nothing".
  if (extraction.reason === "not-configured") {
    const result = await createDraftExpense(EMPTY_DRAFT, {
      storage_path: storagePath,
      media_type: mediaType,
      extracted_at: null,
    });
    if (!result.ok) await removeUploadedReceipt(supabase, storagePath);
    return result.ok ? { ok: true, id: result.id } : { ok: false, errors: result.errors };
  }

  // Misconfigured or provider error: the operator MUST see why the fields are
  // empty. A disabled button or a silently blank draft would read as "the AI
  // found nothing on this receipt", which is a different and wrong conclusion.
  const detail =
    extraction.reason === "misconfigured"
      ? `Receipt scanning is misconfigured: ${extraction.detail}`
      : `Receipt scanning failed: ${extraction.detail}`;

  const result = await createDraftExpense(EMPTY_DRAFT, {
    storage_path: storagePath,
    media_type: mediaType,
    extracted_at: null,
    extraction_error: detail,
  });
  if (!result.ok) await removeUploadedReceipt(supabase, storagePath);
  return result.ok
    ? { ok: true, id: result.id, warning: `${detail} Enter the fields manually.` }
    : { ok: false, errors: result.errors };
}
