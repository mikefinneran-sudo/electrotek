import "server-only";
import { isSupabaseConfigured } from "@waltersignal/bananaforce-data-supabase/client";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import {
  deriveLicenseStatus,
  documentValidationErrors,
  licenseExpiryAlerts,
  licenseValidationErrors,
  renewalValidationErrors,
} from "./lifecycle";
import type {
  CreateLicenseDocumentInput,
  CreateLicenseInput,
  HolderOption,
  License,
  LicenseDocument,
  LicenseDocumentWithUrl,
  LicenseExpiryAlert,
  LicenseRenewal,
  LicenseWithStatus,
  RecordRenewalInput,
  UpdateLicenseInput,
} from "./types";

export interface WriteResult {
  ok: boolean;
  id?: string;
  errors?: string[];
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLicense(input: CreateLicenseInput): CreateLicenseInput {
  return {
    holder_type: input.holder_type,
    staff_holder_id: input.staff_holder_id,
    asset_holder_id: input.asset_holder_id,
    license_name: input.license_name.trim(),
    issuing_authority: input.issuing_authority.trim(),
    jurisdiction: optionalText(input.jurisdiction),
    license_number: optionalText(input.license_number),
    issued_date: input.issued_date || null,
    expiry_date: input.expiry_date || null,
    renewal_window_days: input.renewal_window_days,
    ceu_hours_required: input.ceu_hours_required,
    notes: optionalText(input.notes),
  };
}

function normalizeRenewal(input: RecordRenewalInput): RecordRenewalInput {
  return {
    license_id: input.license_id,
    renewed_on: input.renewed_on,
    new_expiry_date: input.new_expiry_date || null,
    ceu_hours_completed: input.ceu_hours_completed,
    notes: optionalText(input.notes),
  };
}

function normalizeDocument(input: CreateLicenseDocumentInput): CreateLicenseDocumentInput {
  return {
    license_id: input.license_id,
    renewal_id: input.renewal_id || null,
    document_kind: input.document_kind,
    storage_path: input.storage_path,
    media_type: input.media_type,
    original_filename: optionalText(input.original_filename),
    file_size_bytes: input.file_size_bytes,
  };
}

function mergeLicenseInput(existing: License, patch: UpdateLicenseInput): CreateLicenseInput {
  const value = <K extends keyof CreateLicenseInput>(field: K): CreateLicenseInput[K] =>
    Object.prototype.hasOwnProperty.call(patch, field)
      ? (patch[field] as CreateLicenseInput[K])
      : existing[field];

  return {
    holder_type: value("holder_type"),
    staff_holder_id: value("staff_holder_id"),
    asset_holder_id: value("asset_holder_id"),
    license_name: value("license_name"),
    issuing_authority: value("issuing_authority"),
    jurisdiction: value("jurisdiction"),
    license_number: value("license_number"),
    issued_date: value("issued_date"),
    expiry_date: value("expiry_date"),
    renewal_window_days: value("renewal_window_days"),
    ceu_hours_required: value("ceu_hours_required"),
    notes: value("notes"),
  };
}

function sortLicenses(licenses: LicenseWithStatus[]): LicenseWithStatus[] {
  return [...licenses].sort((a, b) => {
    if (a.expiry_date === null && b.expiry_date !== null) return 1;
    if (a.expiry_date !== null && b.expiry_date === null) return -1;
    if (a.expiry_date !== b.expiry_date) {
      return String(a.expiry_date).localeCompare(String(b.expiry_date));
    }
    return a.license_name.localeCompare(b.license_name);
  });
}

/** Staff and assets offered as holders, plus the firm's legal name for company licenses. */
export async function listHolderOptions(): Promise<{
  staff: HolderOption[];
  assets: HolderOption[];
  companyName: string | null;
}> {
  const empty = { staff: [], assets: [], companyName: null };
  if (!isSupabaseConfigured()) return empty;
  try {
    const supabase = await getSupabaseServerClient();
    const [staff, assets, company] = await Promise.all([
      supabase.from("staff").select("id, email, name"),
      supabase.from("assets").select("id, name, serial").order("name").limit(500),
      supabase.from("corporate_profile").select("legal_name").maybeSingle(),
    ]);
    return {
      staff: (staff.data ?? [])
        .map((row) => ({ id: String(row.id), label: String(row.name ?? row.email ?? row.id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      assets: (assets.data ?? []).map((row) => ({
        id: String(row.id),
        label: row.serial ? `${row.name} (${row.serial})` : String(row.name),
      })),
      companyName: company.data?.legal_name ? String(company.data.legal_name) : null,
    };
  } catch {
    return empty;
  }
}

export async function listLicenses(now: Date | string): Promise<LicenseWithStatus[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.from("licenses")
      .select("*")
      // Soonest expiry first, so a cap never drops an expired or due license.
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) return [];
    return sortLicenses(((data ?? []) as License[]).map((license) => deriveLicenseStatus(license, now)));
  } catch {
    return [];
  }
}

export async function getLicense(
  id: string,
  now: Date | string,
): Promise<LicenseWithStatus | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.from("licenses").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return deriveLicenseStatus(data as License, now);
  } catch {
    return null;
  }
}

export async function listRenewals(licenseId: string): Promise<LicenseRenewal[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("license_renewals")
      .select("*")
      .eq("license_id", licenseId)
      .order("renewed_on", { ascending: false });
    if (error) return [];
    return (data ?? []) as LicenseRenewal[];
  } catch {
    return [];
  }
}

export async function listDocuments(licenseId: string): Promise<LicenseDocument[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("license_documents")
      .select("*")
      .eq("license_id", licenseId)
      .order("uploaded_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as LicenseDocument[];
  } catch {
    return [];
  }
}

/** Renewals and documents (with 5-minute signed URLs) for many licenses in three queries. */
export async function listLicenseDetails(licenseIds: string[]): Promise<{
  renewals: LicenseRenewal[];
  documents: LicenseDocumentWithUrl[];
}> {
  if (!isSupabaseConfigured() || licenseIds.length === 0) return { renewals: [], documents: [] };
  try {
    const supabase = await getSupabaseServerClient();
    const [renewals, documents] = await Promise.all([
      supabase
        .from("license_renewals")
        .select("*")
        .in("license_id", licenseIds)
        .order("renewed_on", { ascending: false }),
      supabase
        .from("license_documents")
        .select("*")
        .in("license_id", licenseIds)
        .order("uploaded_at", { ascending: false }),
    ]);
    const docs = (documents.data ?? []) as LicenseDocument[];
    const urls = new Map<string, string>();
    if (docs.length > 0) {
      const { data } = await supabase.storage
        .from("license-documents")
        .createSignedUrls(docs.map((document) => document.storage_path), 300);
      for (const entry of data ?? []) {
        if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
      }
    }
    return {
      renewals: (renewals.data ?? []) as LicenseRenewal[],
      documents: docs.map((document) => ({
        ...document,
        signed_url: urls.get(document.storage_path) ?? null,
      })),
    };
  } catch {
    return { renewals: [], documents: [] };
  }
}

export async function listLicenseExpiryAlerts(
  now: Date | string,
): Promise<LicenseExpiryAlert[]> {
  if (!isSupabaseConfigured()) return [];
  return licenseExpiryAlerts(await listLicenses(now));
}

export async function createLicense(input: CreateLicenseInput): Promise<WriteResult> {
  if (!isSupabaseConfigured()) return { ok: false, errors: ["Supabase is not configured."] };

  const normalized = normalizeLicense(input);
  const errors = licenseValidationErrors(normalized);
  if (errors.length > 0) return { ok: false, errors };

  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.from("licenses").insert(normalized).select("id").single();
    if (error || !data) {
      return { ok: false, errors: [error?.message ?? "Could not create license."] };
    }
    return { ok: true, id: String(data.id) };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : "Unknown error."] };
  }
}

export async function updateLicense(id: string, input: UpdateLicenseInput): Promise<WriteResult> {
  if (!isSupabaseConfigured()) return { ok: false, errors: ["Supabase is not configured."] };

  const now = new Date().toISOString();
  const existing = await getLicense(id, now);
  if (!existing) return { ok: false, errors: ["License not found."] };

  const normalized = normalizeLicense(mergeLicenseInput(existing, input));
  const errors = licenseValidationErrors(normalized);
  if (errors.length > 0) return { ok: false, errors };

  // Write only the fields sent, and only if nothing (a renewal, another edit)
  // changed the row since it was read; the RPC bumps updated_at on renewal.
  const changed = Object.fromEntries(
    Object.keys(input).map((field) => [field, normalized[field as keyof CreateLicenseInput]]),
  );

  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("licenses")
      .update({ ...changed, updated_at: now })
      .eq("id", id)
      .eq("updated_at", existing.updated_at)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, errors: [error.message] };
    if (!data) {
      return { ok: false, errors: ["This license changed while you were editing. Reload and try again."] };
    }
    return { ok: true, id };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : "Unknown error."] };
  }
}

export async function recordRenewal(input: RecordRenewalInput): Promise<WriteResult> {
  if (!isSupabaseConfigured()) return { ok: false, errors: ["Supabase is not configured."] };

  const normalized = normalizeRenewal(input);
  const errors = renewalValidationErrors(normalized);
  if (errors.length > 0) return { ok: false, errors };

  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.rpc("record_license_renewal", {
      p_license_id: normalized.license_id,
      p_renewed_on: normalized.renewed_on,
      p_new_expiry_date: normalized.new_expiry_date,
      p_ceu_hours_completed: normalized.ceu_hours_completed,
      p_notes: normalized.notes,
    });
    if (error || !data) {
      return { ok: false, errors: [error?.message ?? "Could not record renewal."] };
    }
    return { ok: true, id: String(data) };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : "Unknown error."] };
  }
}

export async function createLicenseDocument(
  input: CreateLicenseDocumentInput,
): Promise<WriteResult> {
  if (!isSupabaseConfigured()) return { ok: false, errors: ["Supabase is not configured."] };

  const normalized = normalizeDocument(input);
  const errors = documentValidationErrors(normalized);
  if (errors.length > 0) return { ok: false, errors };

  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, errors: ["Not authenticated."] };

    const { data, error } = await supabase
      .from("license_documents")
      .insert({ ...normalized, uploaded_by: user.id })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, errors: [error?.message ?? "Could not create document."] };
    }
    return { ok: true, id: String(data.id) };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : "Unknown error."] };
  }
}

export async function deleteLicenseDocument(id: string): Promise<WriteResult> {
  if (!isSupabaseConfigured()) return { ok: false, errors: ["Supabase is not configured."] };

  try {
    const supabase = await getSupabaseServerClient();
    const { data: document, error: readError } = await supabase
      .from("license_documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (readError || !document) {
      return { ok: false, errors: [readError?.message ?? "Document not found."] };
    }

    const { error } = await supabase.from("license_documents").delete().eq("id", id);
    if (error) return { ok: false, errors: [error.message] };

    const storagePath = (document as LicenseDocument).storage_path;
    const { error: removeError } = await supabase.storage.from("license-documents").remove([storagePath]);
    if (removeError) {
      // The row is gone; the object is orphaned. Log it so it can be cleaned up.
      console.error(`[licensing] could not remove ${storagePath}: ${removeError.message}`);
    }
    return { ok: true, id };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : "Unknown error."] };
  }
}
