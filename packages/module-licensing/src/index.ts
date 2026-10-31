import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const LICENSING_MODULE_ID = "licensing";

export const licensingModule = {
  id: LICENSING_MODULE_ID,
  name: "Licenses",
  description:
    "License and certification register with renewals, documents, and derived expiry status.",
  routes: ["/licenses", "/api/licenses"],
  dataAdapters: ["supabase"],
  audience: "staff",
} satisfies ClientModule;

export const licensingMounts = [
  {
    moduleId: LICENSING_MODULE_ID,
    kind: "page",
    route: "/licenses",
    appFile: "app/licenses/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-licensing/page",
  },
  {
    moduleId: LICENSING_MODULE_ID,
    kind: "route",
    route: "/api/licenses",
    appFile: "app/api/licenses/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-licensing/routes",
    methods: ["GET", "POST", "PATCH"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = licensingMounts;

export type {
  CreateLicenseDocumentInput,
  CreateLicenseInput,
  HolderOption,
  License,
  LicenseDocument,
  LicenseDocumentKind,
  LicenseDocumentMediaType,
  LicenseDocumentWithUrl,
  LicenseExpiryAlert,
  LicenseHolderType,
  LicenseRenewal,
  LicenseStatus,
  LicenseWithStatus,
  RecordRenewalInput,
  UpdateLicenseInput,
} from "./types";

export {
  LICENSE_DOCUMENT_KINDS,
  LICENSE_DOCUMENT_MEDIA_TYPES,
  LICENSE_HOLDER_TYPES,
  LICENSE_STATUSES,
} from "./types";
