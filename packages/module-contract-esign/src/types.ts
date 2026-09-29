export type ContractStatus = "pending" | "sent" | "signed" | "void";

export const CONTRACT_STATUSES: readonly ContractStatus[] = [
  "pending",
  "sent",
  "signed",
  "void",
];

/**
 * One signed cleaning services agreement per accepted inspection. Mirrors the
 * `contracts` table. `signature_path` and `pdf_path` are object paths within the
 * private `contracts` Supabase Storage bucket — never public URLs.
 */
export interface Contract {
  id: string;
  inspection_id: string;
  status: ContractStatus;
  signer_name: string | null;
  signer_title: string | null;
  signature_path: string | null;
  pdf_path: string | null;
  signed_at: string | null;
  signed_ip: string | null;
  signed_user_agent: string | null;
  audit_method: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Audit metadata captured at sign time (stamped into the PDF + the row). */
export interface SignAudit {
  ip?: string | null;
  userAgent?: string | null;
  method?: string | null;
}
