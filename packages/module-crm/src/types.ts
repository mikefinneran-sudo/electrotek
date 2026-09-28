export type OpportunityStatus = "open" | "won" | "lost";

export const OPPORTUNITY_STATUSES: readonly OpportunityStatus[] = ["open", "won", "lost"];

export type ActivityType = "call" | "email" | "meeting" | "note";

export const ACTIVITY_TYPES: readonly ActivityType[] = ["call", "email", "meeting", "note"];

export type CustomFields = Record<string, unknown>;

/** An account (company / organization). Mirrors the `accounts` table. */
export interface Account {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  notes: string | null;
  custom_fields: CustomFields;
  deleted_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Lifecycle of a forensic engagement. Mirrors the `cases_status_valid` CHECK. */
export type CaseStatus = "open" | "on_hold" | "closed";

export const CASE_STATUSES: readonly CaseStatus[] = ["open", "on_hold", "closed"];

/**
 * A case file — the entity a forensic practice is organised around. Expenses
 * attribute to it (`expenses.subject_type = 'case'`) and invoices assemble from
 * it. Mirrors the `cases` table.
 */
export interface Case {
  id: string;
  /** The firm's own file number, and the human key staff cite. Unique. */
  case_number: string;
  /** FK to accounts.id — the carrier or firm that retained us. */
  account_id: string | null;
  /** FK to contacts.id — the current day-to-day contact, which changes. */
  contact_id: string | null;
  title: string;
  status: CaseStatus;
  case_type: string | null;
  incident_date: string | null;
  incident_location: string | null;
  opened_on: string | null;
  closed_on: string | null;
  notes: string | null;
  custom_fields: CustomFields;
  /** Set by the FileMaker conversion; null for cases opened in-product. */
  legacy_id: string | null;
  source_system: string | null;
  deleted_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/** A contact person, optionally linked to an account and/or a lead. */
export interface Contact {
  id: string;
  /** FK to accounts.id; set null on account delete. */
  account_id: string | null;
  /**
   * Optional cross-reference to public.leads (owned by the lead-capture module).
   * Stored as a plain uuid — no FK constraint because lead ownership is in another module.
   */
  lead_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  custom_fields: CustomFields;
  deleted_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/** A CRM deal pipeline containing ordered stages. */
export interface Pipeline {
  id: string;
  name: string;
  is_active: boolean;
  order_index: number;
  created_at?: string;
  updated_at?: string;
}

/** A pipeline stage (e.g. Lead, Qualified, Proposal…). */
export interface PipelineStage {
  id: string;
  pipeline_id: string | null;
  name: string;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
  active: boolean;
  probability_weight: number;
  rotten_days: number | null;
  required_fields: unknown[];
}

/** A sales opportunity tied to an account and/or contact. */
export interface Opportunity {
  id: string;
  account_id: string | null;
  contact_id: string | null;
  stage_id: string | null;
  name: string;
  amount: number | null;
  close_date: string | null;
  status: OpportunityStatus;
  lost_reason: string | null;
  custom_fields: CustomFields;
  deleted_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/** A contact associated with a deal, optionally as its primary contact. */
export interface DealContact {
  deal_id: string;
  contact_id: string;
  role: string | null;
  is_primary: boolean;
  created_at?: string;
  updated_at?: string;
}

/** An activity log entry (call, email, meeting, or note). */
export interface Activity {
  id: string;
  opportunity_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  type: ActivityType;
  body: string | null;
  occurred_at: string;
  created_at?: string;
}

/** A to-do task linked to an opportunity and/or contact. */
export interface CrmTask {
  id: string;
  opportunity_id: string | null;
  contact_id: string | null;
  title: string;
  due_date: string | null;
  done: boolean;
  created_at?: string;
  updated_at?: string;
}
