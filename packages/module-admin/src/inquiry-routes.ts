import { Resend } from "resend";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function notifyTo(): string[] {
  return (process.env.INQUIRY_NOTIFY_TO ?? process.env.LEAD_NOTIFY_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function sendEmail(subject: string, text: string): Promise<{ ok: boolean; skipped?: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const to = notifyTo();
  if (!key || to.length === 0) return { ok: false, skipped: true };
  const from = process.env.INQUIRY_NOTIFY_FROM ?? process.env.LEAD_NOTIFY_FROM ?? "onboarding@resend.dev";
  const resend = new Resend(key);
  const { error } = await resend.emails.send({ from, to, subject, text });
  return error ? { ok: false } : { ok: true };
}

export function createEventRequestPostHandler() {
  return async function POST(request: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const name = clean(body.name, 200);
    const email = clean(body.email, 320);
    if (!name || !email || !EMAIL_RE.test(email)) {
      return Response.json({ error: "Name and a valid email are required." }, { status: 400 });
    }

    const row = {
      name,
      email,
      phone: clean(body.phone, 40),
      event_type: clean(body.eventType, 80),
      event_date: clean(body.eventDate, 40),
      budget: clean(body.budget, 80),
      location: clean(body.location, 200),
      message: clean(body.message, 4000),
    };

    let saved = false;
    let emailed = false;

    try {
      const { getSupabaseServerClient } = await import(
        "@waltersignal/bananaforce-data-supabase/server"
      );
      const { isSupabaseConfigured } = await import(
        "@waltersignal/bananaforce-data-supabase/client"
      );
      if (isSupabaseConfigured()) {
        const supabase = await getSupabaseServerClient();
        const { error } = await supabase.from("event_requests").insert({
          name: row.name,
          email: row.email,
          phone: row.phone,
          event_type: row.event_type,
          event_date: row.event_date || null,
          budget: row.budget,
          location: row.location,
          message: row.message,
        });
        if (!error) saved = true;
      }
    } catch {
      // best-effort
    }

    const mail = await sendEmail(
      `Event request — ${name}`,
      Object.entries(row)
        .map(([k, v]) => `${k}: ${v ?? "—"}`)
        .join("\n"),
    );
    if (mail.ok) emailed = true;

    if (!saved && !emailed) {
      return Response.json({ error: "Could not submit your request." }, { status: 500 });
    }
    return Response.json({ ok: true });
  };
}

export function createEventRouteHandlers() {
  const POST = createEventRequestPostHandler();
  return { POST };
}

export function createWholesaleInquiryPostHandler() {
  return async function POST(request: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const company = clean(body.company, 200);
    const contactName = clean(body.contactName, 200);
    const email = clean(body.email, 320);
    if (!company || !contactName || !email || !EMAIL_RE.test(email)) {
      return Response.json(
        { error: "Company, contact name, and a valid email are required." },
        { status: 400 },
      );
    }

    const row = {
      company,
      contact_name: contactName,
      email,
      tax_exempt: body.taxExempt === true,
      phone: clean(body.phone, 40),
      business_type: clean(body.businessType, 80),
      tax_id: clean(body.taxId, 60),
      resale_cert: clean(body.resaleCert, 80),
      address: clean(body.address, 200),
      city: clean(body.city, 120),
      state: clean(body.state, 60),
      zip: clean(body.zip, 20),
      est_volume: clean(body.estVolume, 120),
      message: clean(body.message, 4000),
    };

    let saved = false;
    let emailed = false;

    try {
      const { getSupabaseServerClient } = await import(
        "@waltersignal/bananaforce-data-supabase/server"
      );
      const { isSupabaseConfigured } = await import(
        "@waltersignal/bananaforce-data-supabase/client"
      );
      if (isSupabaseConfigured()) {
        const supabase = await getSupabaseServerClient();
        const { error } = await supabase.from("wholesale_inquiries").insert(row);
        if (!error) saved = true;
      }
    } catch {
      // best-effort
    }

    const mail = await sendEmail(
      `Wholesale inquiry — ${company}`,
      Object.entries(row)
        .map(([k, v]) => `${k}: ${v ?? "—"}`)
        .join("\n"),
    );
    if (mail.ok) emailed = true;

    if (!saved && !emailed) {
      return Response.json({ error: "Could not submit your inquiry." }, { status: 500 });
    }
    return Response.json({ ok: true });
  };
}

export function createWholesaleRouteHandlers() {
  const POST = createWholesaleInquiryPostHandler();
  return { POST };
}
