import { buildLeadNotificationEmail } from "./email";
import { createContactPostHandler } from "./routes";
import {
  checkRateLimit,
  enforceRateLimit,
  resetRateLimit,
  RATE_MAX,
  validateLeadInput,
} from "./validation";

let passed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, run: () => void): void {
  try {
    resetRateLimit();
    run();
    passed += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}: ${message}`);
  }
}

async function testAsync(name: string, run: () => Promise<void>): Promise<void> {
  try {
    resetRateLimit();
    await run();
    passed += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}: ${message}`);
  }
}

test("validation accepts valid required fields", () => {
  const result = validateLeadInput({
    name: " Ada Lovelace ",
    company: " Example Co. ",
    email: "ada@example.com ",
    phone: " 555-0100 ",
    office: " 123 Main ",
    notes: " Hello ",
  });

  assert(result.ok && !result.honeypot, "valid input should pass");
  assert(result.data.name === "Ada Lovelace", "name should be trimmed");
  assert(result.data.email === "ada@example.com", "email should be trimmed");
});

test("validation rejects missing and invalid email fields", () => {
  const missing = validateLeadInput({ name: "", email: "" });
  assert(!missing.ok, "missing required fields should fail");
  assert(
    !missing.ok && missing.errors.includes("Name and email are required"),
    "missing required error should be present",
  );

  const invalid = validateLeadInput({ name: "Ada", email: "not-email" });
  assert(!invalid.ok, "invalid email should fail");
  assert(
    !invalid.ok && invalid.errors.includes("A valid email is required"),
    "invalid email error should be present",
  );
});

test("honeypot short-circuits as success", () => {
  const result = validateLeadInput({
    website: "https://spam.example",
    name: "",
    email: "bad",
  });

  assert(result.ok && result.honeypot, "honeypot should return success");
});

test("rate limiter blocks the sixth hit inside ten minutes", () => {
  const now = 1_000_000;

  for (let index = 0; index < 5; index += 1) {
    const result = checkRateLimit("203.0.113.10", now + index);
    assert(result.allowed, `hit ${index + 1} should be allowed`);
  }

  const blocked = checkRateLimit("203.0.113.10", now + 5);
  assert(!blocked.allowed, "sixth hit should be blocked");
});

test("email HTML escapes submitted values", () => {
  const email = buildLeadNotificationEmail({
    name: "<script>alert(1)</script>",
    company: "A&B",
    email: "ada@example.com",
    phone: "\"555\"",
    office: "O'Hare",
    notes: "<b>Hello</b>",
    source: "unit-test",
  });

  assert(email.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "name should be escaped");
  assert(email.html.includes("A&amp;B"), "company should be escaped");
  assert(email.html.includes("&quot;555&quot;"), "phone should be escaped");
  assert(email.html.includes("O&#39;Hare"), "office should be escaped");
  assert(!email.html.includes("<b>Hello</b>"), "notes should not render raw HTML");
});

await testAsync("route handler returns setup-safe error when Supabase env is missing", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  try {
    const POST = createContactPostHandler({ getClientIp: () => "203.0.113.77" });
    const response = await POST(
      new Request("https://example.test/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ada Lovelace",
          email: "ada@example.com",
          notes: "Please call.",
        }),
      }),
    );
    const body = (await response.json()) as {
      ok?: boolean;
      setupRequired?: boolean;
      error?: string;
    };

    assert(response.status === 503, `expected 503, got ${response.status}`);
    assert(body.ok === false, "response should not be ok");
    assert(body.setupRequired === true, "response should mark setupRequired");
    assert(typeof body.error === "string", "response should include an error");
    assert(!body.error.includes("NEXT_PUBLIC"), "error should not expose env var names");
    assert(!body.error.includes("SUPABASE"), "error should not expose env var names");
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }
    if (previousKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
    }
  }
});

await testAsync("route handler 404s when the module is disabled at runtime", async () => {
  const POST = createContactPostHandler({
    getClientIp: () => "203.0.113.78",
    enabled: false,
  });
  const response = await POST(
    new Request("https://example.test/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ada Lovelace",
        email: "ada@example.com",
        notes: "Please call.",
      }),
    }),
  );
  const body = (await response.json()) as { ok?: boolean };

  assert(response.status === 404, `expected 404, got ${response.status}`);
  assert(body.ok === false, "response should not be ok");
});

await testAsync("enforceRateLimit falls back to in-memory when Upstash is unset", async () => {
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  try {
    let last = await enforceRateLimit("1.2.3.4");
    for (let i = 1; i < RATE_MAX; i += 1) last = await enforceRateLimit("1.2.3.4");
    assert(last.allowed, "within the limit should be allowed");
    const over = await enforceRateLimit("1.2.3.4");
    assert(!over.allowed, "exceeding RATE_MAX should be blocked");
    assert(over.retryAfterMs > 0, "blocked result should report retryAfterMs");
  } finally {
    if (prevUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = prevUrl;
  }
});

console.log(`validation tests passed (${passed})`);
