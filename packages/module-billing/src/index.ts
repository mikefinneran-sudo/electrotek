import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const BILLING_MODULE_ID = "billing";

export const billingModule = {
  id: BILLING_MODULE_ID,
  name: "Billing",
  description:
    "Supabase-backed invoicing, Stripe payment intents, and token-gated client pay-links.",
  routes: ["/billing", "/pay", "/api/billing", "/api/stripe-webhook"],
  dataAdapters: ["supabase"],
  audience: "staff",
} satisfies ClientModule;


export const billingMounts = [
  {
    moduleId: BILLING_MODULE_ID,
    kind: "page",
    route: "/billing",
    appFile: "app/billing/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-billing/page",
  },
  {
    moduleId: BILLING_MODULE_ID,
    kind: "page",
    route: "/pay",
    appFile: "app/pay/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-billing/pay-page",
  },
  {
    moduleId: BILLING_MODULE_ID,
    kind: "route",
    route: "/api/billing",
    appFile: "app/api/billing/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-billing/routes",
    methods: ["GET", "POST", "PATCH"],
  },
  {
    moduleId: BILLING_MODULE_ID,
    kind: "route",
    route: "/api/stripe-webhook",
    appFile: "app/api/stripe-webhook/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-billing/routes",
    methods: ["POST"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = billingMounts;

export type { Invoice, InvoiceStatus, Payment, PaymentStatus, ClientInvoice } from "./types";
export { INVOICE_STATUSES, PAYMENT_STATUSES } from "./types";
