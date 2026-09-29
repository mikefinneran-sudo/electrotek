import {
  LEAD_METADATA_FIELDS,
  type LeadCaptureInput,
  type LeadCaptureRecord,
} from "./index";

export const FIELD_LIMITS = {
  name: 200,
  company: 200,
  email: 254,
  phone: 50,
  office: 300,
  notes: 5000,
  message: 5000,
} as const;

export const METADATA_FIELD_LIMITS = {
  inquiry_type: 200,
  role: 200,
  timeline: 200,
  referral_source: 300,
  new_client: 50,
} as const;

export const MAX_METADATA_KEY_LENGTH = 100;
export const MAX_METADATA_VALUE_LENGTH = 2000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const ALLOWED_ATTACHMENT_MIMES = new Set<string>(ALLOWED_ATTACHMENT_MIME_TYPES);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_MAX = 5;

type SanitizedLeadFields = Omit<
  LeadCaptureRecord,
  "source" | "ipHash" | "userAgent" | "attachments"
>;

export type LeadValidationResult =
  | {
      ok: true;
      honeypot: true;
    }
  | {
      ok: true;
      honeypot: false;
      data: SanitizedLeadFields;
    }
  | {
      ok: false;
      honeypot: false;
      errors: string[];
      data: SanitizedLeadFields;
    };

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterMs: number;
}

const hits = new Map<string, number[]>();

const RESERVED_INPUT_FIELDS = new Set([
  "name",
  "company",
  "email",
  "phone",
  "office",
  "notes",
  "message",
  "website",
  "cf-turnstile-response",
  "turnstileToken",
  "attachment",
  "attachments",
  "attachments[]",
  "file",
  "files",
  ...LEAD_METADATA_FIELDS,
]);

function field(input: LeadCaptureInput, key: keyof typeof FIELD_LIMITS): string {
  return String(input[key] ?? "")
    .trim()
    .slice(0, FIELD_LIMITS[key]);
}

function metadataString(value: unknown, limit: number): string {
  return String(value ?? "").trim().slice(0, limit);
}

function safeMetadataValue(value: unknown): unknown {
  if (typeof value === "string") {
    const sanitized = value.trim().slice(0, MAX_METADATA_VALUE_LENGTH);
    return sanitized || undefined;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, 20)
      .map(safeMetadataValue)
      .filter((item) => item !== undefined);
    return sanitized.length > 0 ? sanitized : undefined;
  }
  return undefined;
}

function leadMetadata(input: LeadCaptureInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

  for (const key of LEAD_METADATA_FIELDS) {
    const value = metadataString(input[key], METADATA_FIELD_LIMITS[key]);
    if (value) metadata[key] = value;
  }

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim().slice(0, MAX_METADATA_KEY_LENGTH);
    if (
      !key ||
      RESERVED_INPUT_FIELDS.has(key) ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      continue;
    }

    const value = safeMetadataValue(rawValue);
    if (value !== undefined) metadata[key] = value;
  }

  return metadata;
}

export function validateLeadInput(input: LeadCaptureInput): LeadValidationResult {
  const honeypot = String(input.website ?? "").trim();

  if (honeypot) {
    return { ok: true, honeypot: true };
  }

  const data: SanitizedLeadFields = {
    name: field(input, "name"),
    company: field(input, "company"),
    email: field(input, "email"),
    phone: field(input, "phone"),
    office: field(input, "office"),
    // ElectroTek calls the narrative field `message`; existing module forms
    // call it `notes`. The explicit destination is the notes column, never
    // metadata, with the legacy name retained as a compatibility fallback.
    notes: field(input, "message") || field(input, "notes"),
    metadata: leadMetadata(input),
  };

  const errors: string[] = [];

  if (!data.name || (!data.email && !data.phone)) {
    // Preserve the existing public error text for today's email-first form;
    // 0004/0055 additionally permits phone-only callers.
    errors.push("Name and email are required");
  }

  if (data.email && !EMAIL_RE.test(data.email)) {
    errors.push("A valid email is required");
  }

  if (errors.length > 0) {
    return { ok: false, honeypot: false, errors, data };
  }

  return { ok: true, honeypot: false, data };
}

export function isAllowedAttachmentMime(mimeType: string): boolean {
  return ALLOWED_ATTACHMENT_MIMES.has(mimeType.toLowerCase().trim());
}

export type AttachmentValidationResult =
  | { ok: true; files: File[] }
  | { ok: false; errors: string[] };

export function validateLeadAttachments(files: readonly File[]): AttachmentValidationResult {
  const errors: string[] = [];

  for (const file of files) {
    const label = file.name || "Attachment";
    if (!isAllowedAttachmentMime(file.type)) {
      errors.push(`${label}: file type is not allowed`);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      errors.push(`${label}: file must be 10 MB or smaller`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, files: [...files] };
}

// Best-effort per-IP throttle. Module scope persists across warm invocations on
// the same serverless instance; it is a backstop, not a hard abuse boundary.
export function checkRateLimit(ip: string, now = Date.now()): RateLimitResult {
  if (!ip) {
    return { allowed: true, count: 0, retryAfterMs: 0 };
  }

  const recent = (hits.get(ip) ?? []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  // Bound memory without nuking active counters: evict only entries whose most
  // recent hit is already outside the window (best-effort backstop).
  if (hits.size > 5000) {
    for (const [key, timestamps] of hits) {
      const last = timestamps[timestamps.length - 1] ?? 0;
      if (key !== ip && now - last >= RATE_WINDOW_MS) hits.delete(key);
    }
  }

  const oldest = recent[0] ?? now;

  return {
    allowed: recent.length <= RATE_MAX,
    count: recent.length,
    retryAfterMs: Math.max(0, RATE_WINDOW_MS - (now - oldest)),
  };
}

export function resetRateLimit(): void {
  hits.clear();
}

// Distributed (cross-instance) limiter via Upstash Redis REST, used when both
// env vars are set. Returns null when Upstash is unconfigured or unreachable so
// the caller falls back to the in-memory backstop (fail-open, never blocks the
// form on an infra hiccup).
async function upstashRateLimit(ip: string, now: number): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  // True sliding window via a sorted set (matches the in-memory limiter, no
  // fixed-window boundary burst): evict entries older than the window, add this
  // hit, count what remains, and refresh the key TTL.
  const key = `lead_rl:${ip}`;
  const member = `${now}-${Math.random().toString(36).slice(2)}`;
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["ZREMRANGEBYSCORE", key, "0", String(now - RATE_WINDOW_MS)],
        ["ZADD", key, String(now), member],
        ["ZCARD", key],
        ["PEXPIRE", key, String(RATE_WINDOW_MS)],
      ]),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { result?: unknown }[];
    const count = Number(out[2]?.result ?? 0);
    if (!Number.isFinite(count) || count <= 0) return null;
    return {
      allowed: count <= RATE_MAX,
      count,
      retryAfterMs: RATE_WINDOW_MS,
    };
  } catch {
    return null;
  }
}

/**
 * Per-IP throttle that prefers a distributed Upstash counter (durable across
 * serverless instances) and falls back to the in-memory backstop when Upstash
 * is not configured. Routes should call this.
 */
export async function enforceRateLimit(ip: string, now = Date.now()): Promise<RateLimitResult> {
  if (!ip) return { allowed: true, count: 0, retryAfterMs: 0 };
  const distributed = await upstashRateLimit(ip, now);
  return distributed ?? checkRateLimit(ip, now);
}
