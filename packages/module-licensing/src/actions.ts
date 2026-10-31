"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import {
  createLicense,
  createLicenseDocument,
  deleteLicenseDocument,
  recordRenewal,
  updateLicense,
  type WriteResult,
} from "./server";
import type {
  CreateLicenseInput,
  LicenseDocumentKind,
  LicenseDocumentMediaType,
} from "./types";
import { LICENSE_DOCUMENT_KINDS } from "./types";
import { licensePatch } from "./lifecycle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_STAFF: WriteResult = { ok: false, errors: ["Staff sign-in required."] };

/**
 * Server actions are public endpoints. RLS already refuses non-staff writes;
 * this refuses them before any work (a 10 MB read, a storage call) is done.
 */
async function isStaffCaller(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.rpc("is_staff");
  return data === true;
}

const ALLOWED: Record<string, LicenseDocumentMediaType> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};

const MAX_BYTES = 10 * 1024 * 1024;

function deleteAuditFields(formData: FormData): void {
  for (const field of ["recorded_by", "recorded_at", "uploaded_by", "uploaded_at"]) {
    formData.delete(field);
  }
}

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(formData: FormData, field: string): number | null {
  const value = text(formData, field);
  if (value === null) return null;
  return Number(value);
}

function licenseFromForm(formData: FormData): CreateLicenseInput {
  const holderType = text(formData, "holder_type") ?? "staff";

  return {
    holder_type: holderType as CreateLicenseInput["holder_type"],
    staff_holder_id: holderType === "staff" ? text(formData, "staff_holder_id") : null,
    asset_holder_id: holderType === "asset" ? text(formData, "asset_holder_id") : null,
    license_name: text(formData, "license_name") ?? "",
    issuing_authority: text(formData, "issuing_authority") ?? "",
    jurisdiction: text(formData, "jurisdiction"),
    license_number: text(formData, "license_number"),
    issued_date: text(formData, "issued_date"),
    expiry_date: text(formData, "expiry_date"),
    renewal_window_days: numberOrNull(formData, "renewal_window_days") ?? 60,
    ceu_hours_required: numberOrNull(formData, "ceu_hours_required"),
    notes: text(formData, "notes"),
  };
}

function revalidateLicenses(result: WriteResult): WriteResult {
  if (result.ok) revalidatePath("/licenses");
  return result;
}

async function removeUploadedDocument(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  storagePath: string,
): Promise<void> {
  const { error } = await supabase.storage.from("license-documents").remove([storagePath]);
  if (error) console.error(`[licensing] could not remove ${storagePath}: ${error.message}`);
}

export async function createLicenseAction(formData: FormData): Promise<WriteResult> {
  if (!(await isStaffCaller())) return NOT_STAFF;
  deleteAuditFields(formData);
  return revalidateLicenses(await createLicense(licenseFromForm(formData)));
}

export async function updateLicenseAction(formData: FormData): Promise<WriteResult> {
  deleteAuditFields(formData);
  const id = text(formData, "id");
  if (!id) return { ok: false, errors: ["id is required"] };
  if (!(await isStaffCaller())) return NOT_STAFF;
  const patch = licensePatch((field) => (formData.has(field) ? formData.get(field) : undefined));
  return revalidateLicenses(await updateLicense(id, patch));
}

export async function recordRenewalAction(formData: FormData): Promise<WriteResult> {
  if (!(await isStaffCaller())) return NOT_STAFF;
  deleteAuditFields(formData);
  const result = await recordRenewal({
    license_id: text(formData, "license_id") ?? "",
    renewed_on: text(formData, "renewed_on") ?? "",
    new_expiry_date: text(formData, "new_expiry_date"),
    ceu_hours_completed: numberOrNull(formData, "ceu_hours_completed"),
    notes: text(formData, "renewal_notes"),
  });
  return revalidateLicenses(result);
}

export async function deleteLicenseDocumentAction(formData: FormData): Promise<WriteResult> {
  deleteAuditFields(formData);
  const id = text(formData, "document_id");
  if (!id) return { ok: false, errors: ["document_id is required"] };
  if (!(await isStaffCaller())) return NOT_STAFF;
  return revalidateLicenses(await deleteLicenseDocument(id));
}

export async function uploadLicenseDocument(formData: FormData): Promise<WriteResult> {
  if (!(await isStaffCaller())) return NOT_STAFF;
  deleteAuditFields(formData);

  const file = formData.get("document");
  if (!(file instanceof File)) return { ok: false, errors: ["No file was submitted."] };

  const mediaType = ALLOWED[file.type];
  if (!mediaType) return { ok: false, errors: [`Unsupported file type "${file.type}".`] };
  if (file.size > MAX_BYTES) {
    return { ok: false, errors: ["License documents must be 10 MB or smaller."] };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, errors: ["Supabase is not configured."] };
  }

  const licenseId = text(formData, "license_id");
  const renewalId = text(formData, "renewal_id");
  const documentKind = (text(formData, "document_kind") ?? "certificate") as LicenseDocumentKind;
  // Validate before uploading so a bad request never leaves an orphaned object.
  if (!licenseId || !UUID.test(licenseId)) return { ok: false, errors: ["license_id must be a license id"] };
  if (renewalId && !UUID.test(renewalId)) return { ok: false, errors: ["renewal_id must be a renewal id"] };
  if (!LICENSE_DOCUMENT_KINDS.includes(documentKind)) {
    return { ok: false, errors: ["document_kind must be card, certificate, or coi"] };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const storagePath = `${licenseId}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}`;

  const supabase = await getSupabaseServerClient();
  const { error: uploadError } = await supabase.storage
    .from("license-documents")
    .upload(storagePath, bytes, { contentType: mediaType, upsert: false });
  if (uploadError) return { ok: false, errors: [uploadError.message] };

  const result = await createLicenseDocument({
    license_id: licenseId,
    renewal_id: renewalId,
    document_kind: documentKind,
    storage_path: storagePath,
    media_type: mediaType,
    original_filename: file.name,
    file_size_bytes: file.size,
  });

  if (!result.ok) await removeUploadedDocument(supabase, storagePath);
  return revalidateLicenses(result);
}
