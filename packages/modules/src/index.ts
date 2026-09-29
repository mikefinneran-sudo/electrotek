import type { ClientModule } from "@waltersignal/bananaforce-core";

function defineModule(module: ClientModule): ClientModule {
  return module;
}

export const marketingSite = defineModule({
  id: "marketing-site",
  name: "Marketing Site",
  description: "Landing pages, SEO, brand shell.",
  routes: ["/"],
  audience: "public",
});

export const leadCapture = defineModule({
  id: "lead-capture",
  audience: "mixed",
  name: "Lead Capture",
  description: "Contact forms, honeypot, rate limits, email notify.",
  routes: ["/contact", "/api/contact"],
  // Supabase-only until an Airtable adapter ships (WAL-380, deferred). The
  // implemented module package is Supabase-only; keep the catalog in sync.
  dataAdapters: ["supabase"],
});

export const catalog = defineModule({
  id: "catalog",
  audience: "customer",
  name: "Catalog",
  description: "Category browse, product detail, tier-aware pricing.",
  routes: ["/catalog", "/product/:id"],
  dataAdapters: ["supabase"],
});

export const inventory = defineModule({
  id: "inventory",
  audience: "staff",
  name: "Inventory Management",
  description: "Staff stock levels per location, price corrections, and availability control.",
  routes: ["/inventory", "/api/inventory"],
  dataAdapters: ["supabase"],
});

export const ordering = defineModule({
  id: "ordering",
  audience: "mixed",
  requires: ["catalog"],
  name: "Ordering",
  description: "Cart, submit, offline settlement, order email.",
  routes: ["/orders", "/account"],
  dataAdapters: ["supabase"],
});

export const quoteEngine = defineModule({
  id: "quote-engine",
  audience: "mixed",
  name: "Quote Engine",
  description: "Walkthrough pricing, add-ons, quote PDF.",
  routes: ["/intake", "/api/inspection"],
  dataAdapters: ["supabase"],
});

export const contractEsign = defineModule({
  id: "contract-esign",
  audience: "mixed",
  name: "Contract E-Sign",
  description: "Agreement generation, signature pad, PDF storage.",
  routes: ["/sign", "/contract", "/api/sign"],
  dataAdapters: ["supabase"],
});

export const crewPortal = defineModule({
  id: "crew-portal",
  audience: "staff",
  name: "Crew Portal",
  description: "Staff dashboard, pipeline, Supabase Auth.",
  routes: ["/crew", "/api/crew"],
  dataAdapters: ["supabase"],
});

export const visitCheckflow = defineModule({
  id: "visit-checkflow",
  audience: "staff",
  name: "Visit Checkflow",
  description: "Per-visit checklist signoff and photos.",
  routes: ["/visit", "/api/visit"],
  dataAdapters: ["supabase"],
});

export const clientPortal = defineModule({
  id: "client-portal",
  audience: "mixed",
  name: "Client Portal",
  description: "Token-gated client account view and issue reporting.",
  routes: ["/portal", "/api/portal"],
  dataAdapters: ["supabase"],
});

export const admin = defineModule({
  id: "admin",
  audience: "staff",
  requires: ["catalog","ordering"],
  name: "Admin",
  description: "Staff back office: catalog, inventory, orders, inquiries, reporting.",
  routes: [
    "/admin",
    "/admin/login",
    "/admin/reports",
    "/events",
    "/wholesale",
    "/api/admin",
    "/api/events",
    "/api/wholesale",
  ],
  dataAdapters: ["supabase"],
});

// --- ERP roadmap modules (WAL: bananaforce-erp-modules) --------------------
// The remaining 8 service-ops modules from docs/PRICING.md + PLATFORM-ROADMAP.md.
// All Supabase-only (production = single vendor). Registered up-front so parallel
// builds never collide on this registry; implemented per module in module-* pkgs.

export const scheduling = defineModule({
  id: "scheduling",
  audience: "staff",
  name: "Scheduling",
  description: "Jobs/work-orders, calendar, recurring visits, crew assignment.",
  routes: ["/schedule", "/api/schedule"],
  dataAdapters: ["supabase"],
});

export const billing = defineModule({
  id: "billing",
  audience: "staff",
  requires: ["admin"],
  name: "Billing",
  description: "Stripe payments, invoices, payment status.",
  routes: ["/billing", "/api/billing", "/api/stripe-webhook"],
  dataAdapters: ["supabase"],
});

export const communications = defineModule({
  id: "communications",
  audience: "staff",
  name: "Communications",
  description: "Twilio SMS + Resend email; review/reputation requests; message log.",
  routes: ["/messages", "/api/messages"],
  dataAdapters: ["supabase"],
});

export const ticketing = defineModule({
  id: "ticketing",
  audience: "staff",
  name: "Ticketing",
  description:
    "Helpdesk: tickets, assignment, status/SLA, threaded replies (internal + client-facing).",
  routes: ["/tickets", "/api/tickets"],
  dataAdapters: ["supabase"],
});

export const crm = defineModule({
  id: "crm",
  audience: "staff",
  name: "CRM",
  description: "Contacts/accounts, pipeline, activity, tasks.",
  routes: ["/crm", "/api/crm-records"],
  dataAdapters: ["supabase"],
});

export const forensicCase = defineModule({
  id: "forensic-case",
  audience: "staff",
  requires: ["crm"],
  name: "Forensic Case",
  description:
    "Evidence, claimants, case participants, depositions, contact details, and time billing.",
  routes: ["/api/forensic-case"],
  dataAdapters: ["supabase"],
});

export const accounting = defineModule({
  id: "accounting",
  audience: "staff",
  name: "Accounting",
  description:
    "Tiller→Sheets export (default) + Wave GraphQL OAuth; ledger outbox sync.",
  routes: ["/accounting", "/api/accounting", "/api/accounting/oauth/wave"],
  dataAdapters: ["supabase"],
});

export const reporting = defineModule({
  id: "reporting",
  audience: "staff",
  name: "Reporting",
  description: "KPI dashboards + exports over Supabase.",
  routes: ["/reports", "/api/reporting"],
  dataAdapters: ["supabase"],
});

export const assetControls = defineModule({
  id: "asset-controls",
  audience: "staff",
  name: "Asset Controls",
  description:
    "Physical asset register: computers/IT, vans/fleet, tools — assignment, check-out/in, maintenance log.",
  routes: ["/assets", "/api/assets"],
  dataAdapters: ["supabase"],
});

export const expense = defineModule({
  id: "expense",
  audience: "staff",
  name: "Expenses",
  description:
    "Receipt capture with AI-proposed fields, operator confirmation, and ledger export.",
  routes: ["/expenses", "/api/expenses"],
  dataAdapters: ["supabase"],
});

export const cms = defineModule({
  id: "cms",
  audience: "staff",
  name: "CMS",
  description: "Editable marketing content: singletons, pages, and media.",
  routes: ["/admin/content"],
  dataAdapters: ["supabase"],
});

export const receptionist = defineModule({
  id: "receptionist",
  audience: "staff",
  name: "AI Receptionist",
  description:
    "Vapi-backed inbound call answering — call log, transcripts, recordings, and escalation flags.",
  routes: ["/receptionist", "/api/calls"],
  dataAdapters: ["supabase"],
});

export const ALL_MODULES = [
  marketingSite,
  leadCapture,
  catalog,
  inventory,
  ordering,
  quoteEngine,
  contractEsign,
  crewPortal,
  visitCheckflow,
  clientPortal,
  admin,
  scheduling,
  billing,
  communications,
  ticketing,
  crm,
  forensicCase,
  accounting,
  reporting,
  assetControls,
  expense,
  cms,
  receptionist,
] as const;

export const MODULE_BY_ID = Object.fromEntries(
  ALL_MODULES.map((module) => [module.id, module]),
) as Record<(typeof ALL_MODULES)[number]["id"], ClientModule>;
