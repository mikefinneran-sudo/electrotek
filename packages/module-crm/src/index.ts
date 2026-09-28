import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const CRM_MODULE_ID = "crm";

export const crmModule = {
  id: CRM_MODULE_ID,
  name: "CRM",
  description:
    "Supabase-backed accounts, contacts, pipeline stages, opportunities, activities, and tasks. Staff-auth only.",
  routes: ["/crm", "/api/crm-records"],
  dataAdapters: ["supabase"],
  audience: "staff",
} satisfies ClientModule;


export const crmMounts = [
  {
    moduleId: CRM_MODULE_ID,
    kind: "page",
    route: "/crm",
    appFile: "app/crm/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-crm/page",
  },
  {
    moduleId: CRM_MODULE_ID,
    kind: "route",
    route: "/api/crm-records",
    appFile: "app/api/crm-records/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-crm/routes",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = crmMounts;

export { decodeKeysetCursor, encodeKeysetCursor } from "./cursor";
export type { KeysetCursor } from "./cursor";

export type {
  Account,
  Activity,
  ActivityType,
  Contact,
  CrmTask,
  DealContact,
  Opportunity,
  OpportunityStatus,
  Pipeline,
  PipelineStage,
} from "./types";
export { ACTIVITY_TYPES, OPPORTUNITY_STATUSES } from "./types";
