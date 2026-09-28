export const FORENSIC_ENTITIES = [
  "evidence",
  "claimants",
  "addresses",
  "contact_methods",
  "participants",
  "depositions",
  "time_entries",
] as const;

export type ForensicEntity = (typeof FORENSIC_ENTITIES)[number];

export const CONTACT_METHOD_KINDS = ["phone", "email"] as const;
export type ContactMethodKind = (typeof CONTACT_METHOD_KINDS)[number];

export const PARTICIPANT_TYPES = ["expert", "attorney", "contact"] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];

export interface ForensicRecordBase {
  id: string;
  legacy_id: string | null;
  source_system: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CaseEvidence extends ForensicRecordBase {
  case_id: string | null;
  legacy_case_ref: string | null;
  description: string | null;
  piece_count: string | null;
  received_on: string | null;
  report_on: string | null;
  action: string | null;
  action_on: string | null;
  disposition_on: string | null;
  disposition_method: string | null;
  custodian_initials: string | null;
  storage_location: string | null;
  other_location: string | null;
  response: string | null;
  results: string | null;
  returned_to: string | null;
  xray_status: string | null;
  xray_on: string | null;
  work_order_reference: string | null;
}

export interface CaseClaimant extends ForensicRecordBase {
  case_id: string;
  legacy_case_ref: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  loss_date: string | null;
  email: string | null;
  cell_phone: string | null;
  home_phone: string | null;
  work_phone: string | null;
  work_extension: string | null;
  instructions: string | null;
}

export interface Address extends ForensicRecordBase {
  account_id: string | null;
  contact_id: string | null;
  case_id: string | null;
  legacy_account_ref: string | null;
  legacy_contact_ref: string | null;
  legacy_expert_ref: string | null;
  category: string | null;
  line_1: string | null;
  formatted_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

export interface ContactMethod extends ForensicRecordBase {
  kind: ContactMethodKind;
  contact_id: string | null;
  account_id: string | null;
  legacy_contact_ref: string | null;
  legacy_account_ref: string | null;
  label: string | null;
  value: string | null;
  extension: string | null;
  is_primary: boolean;
}

export interface CaseParticipant extends ForensicRecordBase {
  participant_type: ParticipantType;
  case_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  legacy_case_ref: string | null;
  legacy_contact_ref: string | null;
  legacy_account_ref: string | null;
  role: string | null;
  notes: string | null;
}

export interface Deposition extends ForensicRecordBase {
  case_id: string | null;
  legacy_case_ref: string | null;
  deponent: string | null;
  scheduled_on: string | null;
  description: string | null;
  display_text: string | null;
  location: string | null;
}

export interface CaseTimeEntry extends ForensicRecordBase {
  case_id: string;
  staff_id: string | null;
  legacy_case_ref: string | null;
  legacy_staff_ref: string | null;
  entry_date: string | null;
  category: string | null;
  description: string | null;
  hours: number;
  hourly_rate: number | null;
  multiplier: number | null;
  invoice_number: string | null;
  location: string | null;
  billed_amount: number | null;
}

export interface LegacyInput {
  legacy_id?: string | null;
  source_system?: string | null;
}

export interface EvidenceInput extends LegacyInput {
  case_id?: string | null;
  legacy_case_ref?: string | null;
  description?: string | null;
  piece_count?: string | null;
  received_on?: string | null;
  report_on?: string | null;
  action?: string | null;
  action_on?: string | null;
  disposition_on?: string | null;
  disposition_method?: string | null;
  custodian_initials?: string | null;
  storage_location?: string | null;
  other_location?: string | null;
  response?: string | null;
  results?: string | null;
  returned_to?: string | null;
  xray_status?: string | null;
  xray_on?: string | null;
  work_order_reference?: string | null;
}

export interface ClaimantInput extends LegacyInput {
  case_id?: string | null;
  legacy_case_ref?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  status?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  loss_date?: string | null;
  email?: string | null;
  cell_phone?: string | null;
  home_phone?: string | null;
  work_phone?: string | null;
  work_extension?: string | null;
  instructions?: string | null;
}

export interface AddressInput extends LegacyInput {
  account_id?: string | null;
  contact_id?: string | null;
  case_id?: string | null;
  legacy_account_ref?: string | null;
  legacy_contact_ref?: string | null;
  legacy_expert_ref?: string | null;
  category?: string | null;
  line_1?: string | null;
  formatted_address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

export interface ContactMethodInput extends LegacyInput {
  kind?: ContactMethodKind;
  contact_id?: string | null;
  account_id?: string | null;
  legacy_contact_ref?: string | null;
  legacy_account_ref?: string | null;
  label?: string | null;
  value?: string | null;
  extension?: string | null;
  is_primary?: boolean;
}

export interface ParticipantInput extends LegacyInput {
  participant_type?: ParticipantType;
  case_id?: string | null;
  contact_id?: string | null;
  account_id?: string | null;
  legacy_case_ref?: string | null;
  legacy_contact_ref?: string | null;
  legacy_account_ref?: string | null;
  role?: string | null;
  notes?: string | null;
}

export interface DepositionInput extends LegacyInput {
  case_id?: string | null;
  legacy_case_ref?: string | null;
  deponent?: string | null;
  scheduled_on?: string | null;
  description?: string | null;
  display_text?: string | null;
  location?: string | null;
}

export interface TimeEntryInput extends LegacyInput {
  case_id?: string | null;
  staff_id?: string | null;
  legacy_case_ref?: string | null;
  legacy_staff_ref?: string | null;
  entry_date?: string | null;
  category?: string | null;
  description?: string | null;
  hours?: number | null;
  hourly_rate?: number | null;
  multiplier?: number | null;
  invoice_number?: string | null;
  location?: string | null;
  billed_amount?: number | null;
}

export interface ForensicRecordMap {
  evidence: CaseEvidence;
  claimants: CaseClaimant;
  addresses: Address;
  contact_methods: ContactMethod;
  participants: CaseParticipant;
  depositions: Deposition;
  time_entries: CaseTimeEntry;
}

export interface ForensicInputMap {
  evidence: EvidenceInput;
  claimants: ClaimantInput;
  addresses: AddressInput;
  contact_methods: ContactMethodInput;
  participants: ParticipantInput;
  depositions: DepositionInput;
  time_entries: TimeEntryInput;
}
