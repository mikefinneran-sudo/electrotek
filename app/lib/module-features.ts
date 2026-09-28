export type ModuleFeature = {
  icon: string;
  title: string;
  blurb: string;
  href?: string;
  cta?: string;
  featured?: boolean;
};

export const MODULE_FEATURES: Record<string, ModuleFeature> = {
  "marketing-site": {
    icon: "megaphone",
    title: "Marketing site",
    blurb: "Brand shell, SEO, and landing pages for every deploy.",
    href: "/",
    cta: "View site",
  },
  "lead-capture": {
    icon: "envelope",
    title: "Leads",
    blurb: "Inbound lead inbox — triage and status-track contact submissions.",
    href: "/admin/leads",
    cta: "Lead inbox",
  },
  catalog: {
    icon: "grid",
    title: "Catalog",
    blurb: "Manage products, pricing, categories, and wholesale tiers.",
    href: "/admin/catalog",
    cta: "Manage catalog",
    featured: true,
  },
  inventory: {
    icon: "boxes",
    title: "Inventory",
    blurb: "Movement ledger, barcode scan, counts, and transfers.",
    href: "/inventory",
    cta: "Open inventory",
    featured: true,
  },
  ordering: {
    icon: "cart",
    title: "Offline sales",
    blurb: "Customer carts plus a staff submitted-order queue.",
    href: "/sales",
    cta: "Sales queue",
    featured: true,
  },
  admin: {
    icon: "shield",
    title: "Admin",
    blurb: "Staff console for catalog, pricing, approvals, and orders.",
    href: "/admin",
    cta: "Staff console",
  },
  scheduling: {
    icon: "calendar",
    title: "Scheduling",
    blurb: "Work orders, recurring visits, and crew assignment.",
    href: "/schedule",
    cta: "Open schedule",
  },
  crm: {
    icon: "users",
    title: "CRM",
    blurb: "Accounts, pipeline stages, activities, and opportunities.",
    href: "/crm",
    cta: "Open CRM",
    featured: true,
  },
  ticketing: {
    icon: "ticket",
    title: "Ticketing",
    blurb: "Helpdesk tickets, SLA tracking, and threaded replies.",
    href: "/tickets",
    cta: "Open tickets",
  },
  "asset-controls": {
    icon: "wrench",
    title: "Asset controls",
    blurb: "Equipment register with check-out, check-in, and maintenance.",
    href: "/assets",
    cta: "Open assets",
  },
  billing: {
    icon: "invoice",
    title: "Billing",
    blurb: "Invoices, Stripe pay-links, and payment reconciliation.",
    href: "/billing",
    cta: "Open billing",
  },
  communications: {
    icon: "chat",
    title: "Communications",
    blurb: "Twilio SMS and Resend email with a unified message log.",
    href: "/messages",
    cta: "Message log",
  },
  receptionist: {
    icon: "phone",
    title: "AI Receptionist",
    blurb: "Vapi inbound call answering — call log, transcripts, and recordings.",
    href: "/receptionist",
    cta: "Open call log",
  },
  accounting: {
    icon: "ledger",
    title: "Accounting",
    blurb: "Tiller export and Wave OAuth ledger sync connectors.",
    href: "/accounting",
    cta: "Open accounting",
  },
  reporting: {
    icon: "chart",
    title: "Reporting",
    blurb: "Cross-module KPI dashboards and commerce charts.",
    href: "/reports",
    cta: "View reports",
  },
  "client-portal": {
    icon: "portal",
    title: "Client portal",
    blurb: "Operator view: client issue inbox and portal access management.",
    href: "/admin/clients",
    cta: "Manage clients",
  },
  "crew-portal": {
    icon: "chart",
    title: "Crew portal",
    blurb: "Operator command center: MRR, pipeline, leads, and client accounts.",
    href: "/crew",
    cta: "Open crew portal",
    featured: true,
  },
  "quote-engine": {
    icon: "invoice",
    title: "Quote Engine",
    blurb: "Walkthrough pricing, add-ons, and quote PDF generation.",
    href: "/intake",
    cta: "Open intake",
  },
  cms: {
    icon: "grid",
    title: "CMS",
    blurb: "Editable marketing content: singletons, pages, and media.",
    href: "/admin/content",
    cta: "Edit content",
  },
};

export const MODULE_GROUPS = [
  {
    id: "operations",
    label: "Operations",
    description: "Stock, schedules, assets, and staff tools.",
    moduleIds: ["inventory", "scheduling", "asset-controls", "admin", "visit-checkflow", "cms"],
  },
  {
    id: "revenue",
    label: "Revenue",
    description: "Pipeline, orders, and invoicing.",
    moduleIds: ["crew-portal", "crm", "ordering", "billing", "quote-engine", "contract-esign"],
  },
  {
    id: "finance",
    label: "Finance",
    description: "Books sync and executive dashboards.",
    moduleIds: ["accounting", "reporting"],
  },
  {
    id: "support",
    label: "Support",
    description: "Tickets, messages, calls, and inbound leads.",
    moduleIds: ["ticketing", "communications", "receptionist", "lead-capture"],
  },
  {
    id: "customer",
    label: "Customer-facing",
    description: "Shop, portal, and public touchpoints.",
    moduleIds: ["catalog", "client-portal", "marketing-site"],
  },
] as const;

export function featureForModule(
  moduleId: string,
  fallback: { name: string; description: string },
): ModuleFeature {
  return (
    MODULE_FEATURES[moduleId] ?? {
      icon: "grid",
      title: fallback.name,
      blurb: fallback.description,
    }
  );
}
