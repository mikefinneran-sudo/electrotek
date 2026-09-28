import { afterEach, describe, expect, it } from "vitest";
import { buildLeadNotificationEmail, sendLeadNotification } from "./email";

const previousApiKey = process.env.RESEND_API_KEY;
const previousNotifyTo = process.env.LEAD_NOTIFY_TO;

afterEach(() => {
  if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousApiKey;
  if (previousNotifyTo === undefined) delete process.env.LEAD_NOTIFY_TO;
  else process.env.LEAD_NOTIFY_TO = previousNotifyTo;
});

describe("lead notification email", () => {
  it("surfaces taxonomy, unknown metadata, and attachments with HTML escaping", () => {
    const email = buildLeadNotificationEmail({
      name: "Ada",
      company: "ElectroTek",
      email: "ada@example.com",
      phone: "555-0100",
      office: "",
      notes: "Case narrative",
      source: "unit-test",
      metadata: {
        inquiry_type: "Forensic <investigation>",
        role: "Adjuster",
        claim_number: "CL-42",
        rateLimitCount: 1,
      },
      attachments: [
        {
          storagePath: "private/report.pdf",
          fileName: "report<script>.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
        },
      ],
    });

    expect(email.html).toContain("Inquiry Type");
    expect(email.html).toContain("Forensic &lt;investigation&gt;");
    expect(email.html).toContain("Claim Number");
    expect(email.html).toContain("report&lt;script&gt;.pdf");
    expect(email.html).not.toContain("report<script>.pdf");
    expect(email.text).toContain("Attachments:");
    expect(email.text).toContain("report<script>.pdf (application/pdf, 2 KB)");
  });

  it("silently skips sending when notification env vars are absent", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.LEAD_NOTIFY_TO;
    await expect(
      sendLeadNotification({
        name: "Ada",
        company: "",
        email: "ada@example.com",
        phone: "",
        office: "",
        notes: "",
        source: "unit-test",
      }),
    ).resolves.toMatchObject({ ok: false, skipped: true });
  });
});
