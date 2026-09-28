import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const CONTRACT_ESIGN_MODULE_ID = "contract-esign";

export const contractEsignModule = {
  id: CONTRACT_ESIGN_MODULE_ID,
  name: "Contract E-Sign",
  description:
    "Supabase-backed contract signing: turn an accepted inspection into a signed cleaning services agreement via a token-gated client sign link, capture an electronic signature, and store the executed PDF in Supabase Storage.",
  routes: ["/sign", "/contract", "/api/sign"],
  dataAdapters: ["supabase"],
  audience: "mixed",
} satisfies ClientModule;


export const contractEsignMounts = [
  {
    moduleId: CONTRACT_ESIGN_MODULE_ID,
    kind: "page",
    route: "/sign",
    appFile: "app/sign/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-contract-esign/page",
  },
  {
    moduleId: CONTRACT_ESIGN_MODULE_ID,
    kind: "page",
    route: "/contract",
    appFile: "app/contract/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-contract-esign/page",
  },
  {
    moduleId: CONTRACT_ESIGN_MODULE_ID,
    kind: "route",
    route: "/api/sign",
    appFile: "app/api/sign/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-contract-esign/routes",
    methods: ["GET", "POST"],
  },
  {
    moduleId: CONTRACT_ESIGN_MODULE_ID,
    kind: "route",
    route: "/api/contract",
    appFile: "app/api/contract/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-contract-esign/routes",
    methods: ["GET", "POST"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = contractEsignMounts;

export type { Contract, ContractStatus, SignAudit } from "./types";
export { CONTRACT_STATUSES } from "./types";
