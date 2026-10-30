export type ContractStatus = "pending" | "sent" | "signed" | "void";

export const CONTRACT_STATUSES: readonly ContractStatus[] = [
  "pending",
  "sent",
  "signed",
  "void",
];

/**
 * One signed agreement, backed by either an accepted inspection or an uploaded
 * source PDF. Storage path fields are object paths within the private
 * `contracts` Supabase Storage bucket — never public URLs.
 */
export interface Contract {
  id: string;
  inspection_id: string | null;
  title?: string | null;
  source_pdf_path?: string | null;
  signer_email?: string | null;
  signer_address?: string | null;
  deposit_amount_due?: number | null;
  final_amount_due?: number | null;
  card_fee_passthrough?: boolean;
  deposit_invoice_id?: string | null;
  final_invoice_id?: string | null;
  sign_invite_sent_at?: string | null;
  followup_texts?: boolean;
  deposit_invoice_sent_at?: string | null;
  crm_account_id?: string | null;
  crm_opportunity_id?: string | null;
  crm_contact_id?: string | null;
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
