import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const ACCOUNTING_MODULE_ID = "accounting";

export const accountingModule = {
  id: ACCOUNTING_MODULE_ID,
  name: "Accounting",
  description:
    "Tiller→Sheets export (default) + Wave GraphQL OAuth; ledger outbox sync.",
  routes: ["/accounting", "/api/accounting", "/api/accounting/oauth/wave", "/api/accounting/cron"],
  dataAdapters: ["supabase"],
  audience: "staff",
} satisfies ClientModule;


export const accountingMounts = [
  {
    moduleId: ACCOUNTING_MODULE_ID,
    kind: "page",
    route: "/accounting",
    appFile: "app/accounting/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-accounting/page",
  },
  {
    moduleId: ACCOUNTING_MODULE_ID,
    kind: "route",
    route: "/api/accounting",
    appFile: "app/api/accounting/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-accounting/routes",
    methods: ["GET", "POST"],
  },
  {
    moduleId: ACCOUNTING_MODULE_ID,
    kind: "route",
    route: "/api/accounting/cron",
    appFile: "app/api/accounting/cron/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-accounting/routes",
    methods: ["GET"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = accountingMounts;

export type {
  ConnectorName,
  EnqueueLedgerEventInput,
  LedgerAccountMap,
  LedgerEventType,
  LedgerOutboxEvent,
  LedgerSyncLog,
  SyncStatus,
} from "./types";
export { CONNECTOR_NAMES, LEDGER_EVENT_TYPES, SYNC_STATUSES } from "./types";
