import { describe, expect, it } from "vitest";
import {
  capString,
  createForensicCaseRouteHandlers,
  parseListLimit,
  pickForensicInput,
  validateForensicInput,
} from "./routes";
import { MAX_LIST_LIMIT, MAX_NAME, MAX_TEXT } from "./server";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";

describe("forensic route clamps", () => {
  it("clamps pagination to the CRM bounds", () => {
    expect(parseListLimit(null)).toBeUndefined();
    expect(parseListLimit("not-a-number")).toBeUndefined();
    expect(parseListLimit("0")).toBe(1);
    expect(parseListLimit("99.9")).toBe(99);
    expect(parseListLimit("9999")).toBe(MAX_LIST_LIMIT);
  });

  it("uses the CRM name and text caps", () => {
    expect(capString("n".repeat(MAX_NAME + 20), MAX_NAME)).toHaveLength(MAX_NAME);
    expect(capString("t".repeat(MAX_TEXT + 20), MAX_TEXT)).toHaveLength(MAX_TEXT);
  });

  it("caps entity fields according to their shape", () => {
    const input = pickForensicInput("evidence", {
      description: "d".repeat(MAX_TEXT + 10),
      storage_location: "s".repeat(MAX_NAME + 10),
    });
    expect(input.description).toHaveLength(MAX_TEXT);
    expect(input.storage_location).toHaveLength(MAX_NAME);
  });
});

describe("forensic input validation", () => {
  it("keeps API dates ISO-only instead of guessing FileMaker M/D/YYYY", () => {
    expect(
      pickForensicInput("evidence", { received_on: "8/7/2026" }).received_on,
    ).toBeUndefined();
    expect(
      pickForensicInput("evidence", { received_on: "2026-08-07" }).received_on,
    ).toBe("2026-08-07");
  });

  it("coerces malformed foreign keys to null", () => {
    expect(pickForensicInput("addresses", { case_id: "F 2130a" }).case_id).toBeNull();
  });

  it("requires valid email values for email contact methods", () => {
    const invalid = pickForensicInput("contact_methods", {
      kind: "email",
      contact_id: CASE_ID,
      value: "not-an-email",
    });
    expect(validateForensicInput("contact_methods", invalid, true)).toMatch(
      /valid email address/,
    );

    const valid = pickForensicInput("contact_methods", {
      kind: "email",
      contact_id: CASE_ID,
      value: "adjuster@example.com",
    });
    expect(validateForensicInput("contact_methods", valid, true)).toBeNull();
  });

  it("rejects negative time values and accepts the zero boundary", () => {
    const base = {
      case_id: CASE_ID,
      staff_id: STAFF_ID,
      entry_date: "2026-08-31",
    };
    expect(
      validateForensicInput(
        "time_entries",
        pickForensicInput("time_entries", { ...base, hours: -0.25 }),
        true,
      ),
    ).toBe("hours must be a non-negative number.");
    expect(
      validateForensicInput(
        "time_entries",
        pickForensicInput("time_entries", { ...base, hours: 0 }),
        true,
      ),
    ).toBeNull();
  });

  it("requires a real case and party for new case participants", () => {
    const input = pickForensicInput("participants", {
      participant_type: "expert",
      case_id: CASE_ID,
    });
    expect(validateForensicInput("participants", input, true)).toMatch(
      /contact_id or account_id/,
    );
  });
});

describe("forensic route authorization", () => {
  it("denies by default before configuration or data access", async () => {
    const handlers = createForensicCaseRouteHandlers();
    const response = await handlers.GET(
      new Request("https://example.test/api/forensic-case?entity=evidence"),
    );
    expect(response.status).toBe(401);
  });
});
