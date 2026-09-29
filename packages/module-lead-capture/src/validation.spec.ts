import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  validateLeadAttachments,
  validateLeadInput,
} from "./validation";

describe("lead input mapping", () => {
  it("maps message to notes and keeps taxonomy plus unknown fields in metadata", () => {
    const result = validateLeadInput({
      name: " Ada Lovelace ",
      company: " ElectroTek ",
      email: " ada@example.com ",
      phone: " 555-0100 ",
      message: " The complete case narrative ",
      notes: "legacy fallback must not win",
      inquiry_type: "Forensic investigation",
      role: "Adjuster",
      timeline: "Urgent",
      referral_source: "Colleague",
      new_client: "Yes",
      policy_number: "ABC-123",
    });

    expect(result.ok && !result.honeypot).toBe(true);
    if (!result.ok || result.honeypot) return;

    expect(result.data.notes).toBe("The complete case narrative");
    expect(result.data.office).toBe("");
    expect(result.data.metadata).toMatchObject({
      inquiry_type: "Forensic investigation",
      role: "Adjuster",
      timeline: "Urgent",
      referral_source: "Colleague",
      new_client: "Yes",
      policy_number: "ABC-123",
    });
    expect(result.data.metadata).not.toHaveProperty("message");
    expect(result.data.metadata).not.toHaveProperty("notes");
  });

  it("keeps the legacy notes field when message is absent", () => {
    const result = validateLeadInput({
      name: "Ada",
      email: "ada@example.com",
      notes: "Legacy contact form notes",
    });

    expect(result.ok && !result.honeypot && result.data.notes).toBe(
      "Legacy contact form notes",
    );
  });

  it("accepts a phone-only contact in line with migration 0004/0055", () => {
    const result = validateLeadInput({ name: "Grace", phone: "555-0199" });
    expect(result.ok).toBe(true);
  });
});

describe("lead attachment validation", () => {
  it("accepts the legacy PDF, Word, and photo MIME types", () => {
    const result = validateLeadAttachments([
      new File(["pdf"], "report.pdf", { type: "application/pdf" }),
      new File(["doc"], "report.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      new File(["photo"], "scene.jpg", { type: "image/jpeg" }),
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects disallowed MIME types", () => {
    const result = validateLeadAttachments([
      new File(["plain text"], "notes.txt", { type: "text/plain" }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("file type is not allowed");
  });

  it("rejects files larger than 10 MB", () => {
    const oversized = {
      name: "large.pdf",
      type: "application/pdf",
      size: MAX_ATTACHMENT_BYTES + 1,
    } as File;
    const result = validateLeadAttachments([oversized]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("10 MB or smaller");
  });
});
