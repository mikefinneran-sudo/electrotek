import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const CREW_PORTAL_MODULE_ID = "crew-portal";

export const crewPortalModule = {
  id: CREW_PORTAL_MODULE_ID,
  name: "Crew Portal",
  description:
    "Supabase-backed staff dashboard + job pipeline for the service vertical. Aggregates leads, inspections, contracts, checklists, and visit signoffs into MRR/pipeline metrics, a status pipeline, and full per-client detail. Reads via the service-role client; gated by a real staff session (is_staff()).",
  routes: ["/crew", "/api/crew"],
  dataAdapters: ["supabase"],
  audience: "staff",
} satisfies ClientModule;

// Crew portal aggregates across the quote-engine and admin modules: it reuses
// quote-engine's pricing (resolveQuote) for MRR and admin's staff table +
// is_staff() predicate for auth. It also reads contract-esign, visit-checkflow,
// and lead-capture tables, but those are not hard prerequisites for the module
// to load (it degrades to empties); quote-engine + admin are.
export const CREW_PORTAL_REQUIRES = ["quote-engine", "admin"] as const;


export const crewPortalMounts = [
  {
    moduleId: CREW_PORTAL_MODULE_ID,
    kind: "page",
    route: "/crew",
    appFile: "app/crew/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-crew-portal/page",
  },
  {
    moduleId: CREW_PORTAL_MODULE_ID,
    kind: "route",
    route: "/api/crew",
    appFile: "app/api/crew/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-crew-portal/routes",
    methods: ["GET", "PATCH"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = crewPortalMounts;

export type {
  AccountMetrics,
  ChecklistWithItems,
  ClientDetail,
  Contract,
  ContractStatus,
  CrewDashboardData,
  CrewPipelineGroup,
  Inspection,
  InspectionStatus,
  Lead,
  LeadStatus,
  StatusCounts,
  TimelineEvent,
  VisitMetricInput,
  VisitSignoff,
  VisitStatus,
} from "./types";
export { LEAD_STATUSES } from "./types";
export {
  OPEN_PIPELINE_STATUSES,
  buildAccountTimeline,
  computeAccountMetrics,
  countBy,
  groupInspectionsByStatus,
  monthsBetween,
  sumMrr,
  sumPipelineValue,
} from "./metrics";
