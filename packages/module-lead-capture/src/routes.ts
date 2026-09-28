import { createHmac } from "node:crypto";
import { sendLeadNotification } from "./email";
import { insertLead } from "./server";
import { verifyTurnstile } from "./turnstile";
import {
  enforceRateLimit,
  validateLeadAttachments,
  validateLeadInput,
} from "./validation";
import type { LeadCaptureInput, LeadCaptureRecord } from "./index";

export interface ContactRouteOptions {
  source?: string;
  getClientIp?: (request: Request) => string;
  /**
   * WAL-389: defense-in-depth runtime gate. Pass the app's live
   * client.config.ts modules.includes("lead-capture") check so a deploy that
   * disables the module but keeps a stale route mount doesn't leave
   * /api/contact live. `check-mounts` catches drift at CI time only; this
   * closes the gap at request time. Defaults to enabled when omitted, so
   * existing callers (and tests) that don't pass it are unaffected.
   */
  enabled?: boolean;
}

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const firstForwarded = forwardedFor.split(",")[0]?.trim();

  return (
    firstForwarded ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    ""
  );
}

function hashIp(ip: string): string | undefined {
  if (!ip) return undefined;

  // No published default: a known key would make ip_hash a reversible lookup.
  // Omit the hash entirely when no secret is configured.
  const secret = process.env.LEAD_CAPTURE_IP_HASH_SECRET;
  if (!secret) return undefined;
  return createHmac("sha256", secret).update(ip).digest("hex");
}

function sourceValue(options: ContactRouteOptions): string {
  return String(options.source ?? process.env.LEAD_NOTIFY_SOURCE ?? "bananaforce").slice(0, 100);
}

export interface ParsedLeadRequest {
  input: LeadCaptureInput;
  attachments: File[];
  turnstileToken: string;
}

function tokenValue(input: LeadCaptureInput): string {
  return String(input["cf-turnstile-response"] ?? input.turnstileToken ?? "").trim();
}

export async function readLeadInput(request: Request): Promise<ParsedLeadRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    const input =
      typeof body === "object" && body !== null ? (body as LeadCaptureInput) : {};
    return { input, attachments: [], turnstileToken: tokenValue(input) };
  }

  const formData = await request.formData().catch(() => undefined);
  if (!formData) return { input: {}, attachments: [], turnstileToken: "" };

  const input: LeadCaptureInput = {};
  const attachments: File[] = [];

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      input[key] = value;
    } else if (value.size > 0) {
      // Treat every non-empty file part as an attachment. ElectroTek may use a
      // plural field while other client forms use a singular/custom name.
      attachments.push(value);
    }
  }

  return { input, attachments, turnstileToken: tokenValue(input) };
}

export function createContactPostHandler(options: ContactRouteOptions = {}) {
  return async function POST(request: Request): Promise<Response> {
    if (options.enabled === false) {
      return json({ ok: false, error: "Not found." }, { status: 404 });
    }

    const parsed = await readLeadInput(request);
    const validated = validateLeadInput(parsed.input);

    if (validated.ok && validated.honeypot) {
      // Honeypot-tripped requests intentionally bypass rate limiting so bot
      // noise does not burn the real visitor quota for the same shared IP.
      return json({ ok: true });
    }

    const ip = (options.getClientIp ?? clientIp)(request);

    // Captcha intentionally follows the honeypot and precedes the limiter:
    // honeypot classification stays opaque, while invalid captcha traffic
    // cannot consume a real visitor's rate-limit quota.
    const captcha = await verifyTurnstile(parsed.turnstileToken, ip);
    if (!captcha.ok) {
      return json(
        { ok: false, error: "Captcha verification failed." },
        { status: 403 },
      );
    }

    const rateLimit = await enforceRateLimit(ip);

    if (!rateLimit.allowed) {
      return json(
        {
          ok: false,
          error: "Too many requests - please try again shortly.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))),
          },
        },
      );
    }

    if (!validated.ok) {
      return json(
        {
          ok: false,
          error: validated.errors[0] ?? "Lead submission is invalid",
          errors: validated.errors,
        },
        { status: 400 },
      );
    }

    const attachmentValidation = validateLeadAttachments(parsed.attachments);
    if (!attachmentValidation.ok) {
      return json(
        {
          ok: false,
          error: attachmentValidation.errors[0] ?? "Attachment is invalid",
          errors: attachmentValidation.errors,
        },
        { status: 400 },
      );
    }

    const { metadata, ...leadFields } = validated.data;
    const ipHash = hashIp(ip);
    const userAgent = request.headers.get("user-agent") ?? undefined;

    const lead: LeadCaptureRecord = {
      ...leadFields,
      source: sourceValue(options),
      ...(ipHash ? { ipHash } : {}),
      ...(userAgent ? { userAgent } : {}),
      metadata: {
        ...metadata,
        rateLimitCount: rateLimit.count,
      },
    };

    const insertResult = await insertLead(lead, attachmentValidation.files);
    if (!insertResult.ok) {
      return json(
        {
          ok: false,
          error: insertResult.error,
          setupRequired: insertResult.setupRequired,
        },
        { status: insertResult.setupRequired ? 503 : 500 },
      );
    }

    const notificationLead: LeadCaptureRecord = insertResult.attachments
      ? { ...lead, attachments: insertResult.attachments }
      : lead;
    const emailResult = await sendLeadNotification(notificationLead);
    if (!emailResult.ok && emailResult.skipped) {
      console.warn(`Lead notification skipped: ${emailResult.error}`);
    } else if (!emailResult.ok) {
      console.error(`Lead notification failed: ${emailResult.error}`);
    }

    return json({ ok: true });
  };
}
