import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const LEAD_CAPTURE_MODULE_ID = "lead-capture";
export const LEAD_ATTACHMENT_BUCKET = "lead-attachments";

export const LEAD_METADATA_FIELDS = [
  "inquiry_type",
  "role",
  "timeline",
  "referral_source",
  "new_client",
] as const;

export const leadCaptureModule = {
  id: LEAD_CAPTURE_MODULE_ID,
  name: "Lead Capture",
  description: "Supabase-backed contact form, honeypot, rate limits, and email notify.",
  routes: ["/contact", "/api/contact"],
  dataAdapters: ["supabase"],
  audience: "mixed",
} satisfies ClientModule;


export const leadCaptureMounts = [
  {
    moduleId: LEAD_CAPTURE_MODULE_ID,
    kind: "page",
    route: "/contact",
    appFile: "app/contact/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-lead-capture/page",
  },
  {
    moduleId: LEAD_CAPTURE_MODULE_ID,
    kind: "route",
    route: "/api/contact",
    appFile: "app/api/contact/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-lead-capture/routes",
    methods: ["POST"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = leadCaptureMounts;

export type LeadMetadataField = (typeof LEAD_METADATA_FIELDS)[number];

export type LeadCaptureField =
  | "name"
  | "company"
  | "email"
  | "phone"
  | "office"
  | "notes"
  | "message"
  | "website"
  | "cf-turnstile-response"
  | LeadMetadataField;

/** Raw public-form input. Unknown fields are retained as bounded metadata. */
export type LeadCaptureInput = Record<string, unknown>;

export interface LeadAttachmentRecord {
  id?: string;
  leadId?: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt?: string;
  downloadUrl?: string;
}

export interface LeadCaptureRecord {
  name: string;
  company: string;
  email: string;
  phone: string;
  office: string;
  notes: string;
  source: string;
  ipHash?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  attachments?: LeadAttachmentRecord[];
}

export interface LeadCaptureSuccess {
  ok: true;
  leadId?: string;
  attachments?: LeadAttachmentRecord[];
}

export interface LeadCaptureFailure {
  ok: false;
  error: string;
  setupRequired?: boolean;
}

export type LeadCaptureResult = LeadCaptureSuccess | LeadCaptureFailure;
