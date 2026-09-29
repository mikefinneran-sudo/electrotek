import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const VISIT_CHECKFLOW_MODULE_ID = "visit-checkflow";

export const visitCheckflowModule = {
  id: VISIT_CHECKFLOW_MODULE_ID,
  name: "Visit Checkflow",
  description:
    "Supabase-backed per-visit checklist signoff: load an inspection's checklist, check off tasks, add notes and before/after photos, and submit a crew visit signoff.",
  routes: ["/visit", "/api/visit"],
  dataAdapters: ["supabase"],
  audience: "staff",
} satisfies ClientModule;


export const visitCheckflowMounts = [
  {
    moduleId: VISIT_CHECKFLOW_MODULE_ID,
    kind: "page",
    route: "/visit",
    appFile: "app/visit/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-visit-checkflow/page",
  },
  {
    moduleId: VISIT_CHECKFLOW_MODULE_ID,
    kind: "route",
    route: "/api/visit",
    appFile: "app/api/visit/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-visit-checkflow/routes",
    methods: ["GET", "POST"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = visitCheckflowMounts;

export type {
  Checklist,
  ChecklistItem,
  ChecklistStatus,
  ChecklistWithItems,
  GeneratedItem,
  PhotoRole,
  TaskLibraryEntry,
  VisitItemCompletion,
  VisitPhoto,
  VisitSignoff,
  VisitSignoffDetail,
  VisitStatus,
  VisitStatusInput,
  VisitStatusResult,
} from "./types";
export {
  CHECKLIST_STATUSES,
  PHOTO_ROLES,
  VISIT_STATUSES,
} from "./types";
export { calcVisitStatus, generateChecklistItems, matchLineToLibrary } from "./visit";
