// Crew portal types. This module AGGREGATES across already-built modules and
// owns essentially no new tables, so most types are composed from the modules it
// reads (quote-engine, contract-esign, visit-checkflow). The one type defined
// from scratch is `Lead`: lead-capture only exports its INPUT/record shapes
// (LeadCaptureRecord, the public form payload), not a row type for the persisted
// `leads` table — crew-portal reads that table directly via the service-role
// client, so it needs the persisted shape here.

import type { Inspection, InspectionStatus } from "@waltersignal/bananaforce-module-quote-engine";
import type { Contract } from "@waltersignal/bananaforce-module-contract-esign";
import type {
  ChecklistWithItems,
  VisitSignoff,
  VisitStatus,
} from "@waltersignal/bananaforce-module-visit-checkflow";

// Re-export the composed module types so consumers (ui, page) import everything
// crew-portal-shaped from one place.
export type {
  Inspection,
  InspectionStatus,
} from "@waltersignal/bananaforce-module-quote-engine";
export type { Contract, ContractStatus } from "@waltersignal/bananaforce-module-contract-esign";
export type {
  ChecklistWithItems,
  VisitSignoff,
  VisitStatus,
} from "@waltersignal/bananaforce-module-visit-checkflow";

/**
 * Lead lifecycle statuses surfaced in the crew pipeline. Ported from ABC's
 * LEAD_STATUSES (Airtable), lower-cased/snake-cased to match the Supabase
 * `leads.status` text column (which defaults to 'new'). Used to whitelist the
 * status filter and the PATCH target — raw input is never trusted.
 */
export type LeadStatus =
  | "new"
  | "contacted"
  | "walkthrough_scheduled"
  | "quoted"
  | "won"
  | "lost";

export const LEAD_STATUSES: readonly LeadStatus[] = [
  "new",
  "contacted",
  "walkthrough_scheduled",
  "quoted",
  "won",
  "lost",
];

/**
 * A persisted lead row (public.leads, owned by lead-capture). lead-capture only
 * exports the public-form input shape, so the persisted row shape lives here.
 * crew-portal reads this table via the service-role client (leads has no staff
 * select policy) and can PATCH the status.
 */
export interface Lead {
  id: string;
  submitted_at: string | null;
  status: string;
  source: string | null;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  office: string | null;
  notes: string | null;
  /** Extra public-form answers the lead-capture module stored as JSON. */
  metadata: Record<string, unknown> | null;
}

/** Per-status count map (e.g. { new: 3, contacted: 1 }). */
export type StatusCounts = Record<string, number>;

/**
 * Computed per-account metrics for the client-detail view. Ported from ABC's
 * computeAccountMetrics — MRR/LTV are derived from the resolved quote, not a
 * stored field. monthsActive/estimatedLtv are null unless the inspection is
 * accepted (an unaccepted quote is not yet revenue).
 */
export interface AccountMetrics {
  monthlyRevenue: number;
  projectedAnnual: number;
  monthsActive: number | null;
  estimatedLtv: number | null;
  accountSince: string | null;
  isActive: boolean;
  visitCount: number;
  completedVisitCount: number;
}

/** A single dated event on the account timeline (ported from ABC). */
export interface TimelineEvent {
  date: string;
  label: string;
  detail: string;
  visitId?: string;
}

/** Dashboard aggregate: MRR, pipeline counts/value, and recent activity. */
export interface CrewDashboardData {
  leadCounts: StatusCounts;
  pipelineCounts: StatusCounts;
  mrr: number;
  pipelineValue: number;
  activeClientCount: number;
  newLeadCount: number;
  recentLeads: Lead[];
  recentInspections: Inspection[];
}

/** Pipeline view: inspections grouped by status, in canonical status order. */
export interface CrewPipelineGroup {
  status: InspectionStatus;
  inspections: Inspection[];
}

/**
 * Full client detail: the inspection plus its contract, checklist, visits, and
 * computed metrics/timeline. Mirrors ABC's getClientDetail return shape.
 */
export interface ClientDetail {
  inspection: Inspection;
  lead: Lead | null;
  contract: Contract | null;
  checklist: ChecklistWithItems | null;
  visits: VisitSignoff[];
  metrics: AccountMetrics;
  timeline: TimelineEvent[];
}

/** A visit row carrying just the fields the metric/timeline helpers consume. */
export interface VisitMetricInput {
  status: VisitStatus | null;
  visit_date: string | null;
  completed_at: string | null;
}
