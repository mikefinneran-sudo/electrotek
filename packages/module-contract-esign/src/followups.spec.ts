import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getServiceClientOrNull: vi.fn(),
  warnSupabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock(
  "@waltersignal/bananaforce-data-supabase/server-helpers",
  () => supabaseMocks,
);

import {
  defaultSignatureFollowupFirstAt,
  dueFollowups,
  reapStaleEmailClaims,
  rescheduleFollowup,
  signatureFollowupDueDates,
  signatureReminderCheckPrefix,
  signatureReminderText,
} from "./followups";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signature follow-up cadence", () => {
  it("keeps every touch at 18:00 Indianapolis time across DST", () => {
    const due = signatureFollowupDueDates(new Date("2026-10-25T22:00:00.000Z"));

    expect(due.map((date) => date.toISOString())).toEqual([
      "2026-10-25T22:00:00.000Z",
      "2026-10-28T22:00:00.000Z",
      "2026-11-01T23:00:00.000Z",
      "2026-11-05T23:00:00.000Z",
    ]);
  });

  it("defaults the first touch to the third local calendar day at 18:00", () => {
    expect(
      defaultSignatureFollowupFirstAt(
        new Date("2026-10-29T20:30:00.000Z"),
      ).toISOString(),
    ).toBe("2026-11-01T23:00:00.000Z");
  });
});

describe("signature text reminder", () => {
  it("has one stable recovery prefix while the sign token stays ephemeral", () => {
    const body = signatureReminderText({
      signerName: "Sal Example",
      title: "Scapex Client Services Agreement",
      touch: 2,
      signUrl: "https://app.example/sign?token=fresh",
    });

    expect(body).toBe(
      "Hey Sal, quick reminder that your Scapex Client Services Agreement is waiting on your signature. It takes a couple minutes on your phone: https://app.example/sign?token=fresh\n\nMike",
    );
    expect(signatureReminderCheckPrefix(body)).toBe(
      "Hey Sal, quick reminder that your Scapex Client Services Agreement is waiting on your signature. It takes a couple minutes on your phone: ",
    );
  });
});

describe("dueFollowups", () => {
  it("does not query or recover work outside the 09:00 to 20:59 local window", async () => {
    const result = await dueFollowups(
      "text",
      new Date("2026-10-24T12:59:00.000Z"),
    );

    expect(result).toEqual({ claimed: [], canceled: [] });
    expect(supabaseMocks.getServiceClientOrNull).not.toHaveBeenCalled();
  });

  it("claims the highest due touch and cancels older due touches in its group", async () => {
    const rows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        contract_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        touch: 1,
        channel: "email",
        due_at: "2026-10-20T22:00:00.000Z",
        status: "scheduled",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        contract_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        touch: 2,
        channel: "email",
        due_at: "2026-10-23T22:00:00.000Z",
        status: "scheduled",
      },
    ];
    const updates: Array<{ payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
    const client = {
      from: vi.fn(() => {
        let payload: Record<string, unknown> | null = null;
        const filters: Record<string, unknown> = {};
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn((field: string, value: unknown) => {
            filters[field] = value;
            return query;
          }),
          lte: vi.fn(() => query),
          order: vi.fn(() => query),
          limit: vi.fn(async () => ({ data: rows, error: null })),
          update: vi.fn((next: Record<string, unknown>) => {
            payload = next;
            updates.push({ payload: next, filters });
            return query;
          }),
          maybeSingle: vi.fn(async () => {
            const row = rows.find((candidate) => candidate.id === filters.id);
            return { data: row && payload ? { ...row, ...payload } : null, error: null };
          }),
        };
        return query;
      }),
    };
    supabaseMocks.getServiceClientOrNull.mockReturnValue(client);

    const result = await dueFollowups(
      "email",
      new Date("2026-10-24T13:00:00.000Z"),
    );

    expect(result.claimed).toEqual([
      expect.objectContaining({ id: rows[1].id, touch: 2, status: "sending" }),
    ]);
    expect(result.canceled).toEqual([
      expect.objectContaining({
        id: rows[0].id,
        touch: 1,
        status: "canceled",
        error: "Superseded by a later touch.",
      }),
    ]);
    expect(updates.map(({ payload }) => payload)).toEqual([
      { status: "canceled", error: "Superseded by a later touch." },
      {
        status: "sending",
        sending_at: "2026-10-24T13:00:00.000Z",
        error: null,
      },
    ]);
  });
});

describe("email claim recovery", () => {
  it("fails sending claims older than 30 minutes with the outcome-unknown error", async () => {
    const updates: Record<string, unknown>[] = [];
    const filters: unknown[][] = [];
    const stale = {
      id: "11111111-1111-4111-8111-111111111111",
      contract_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      touch: 1,
      channel: "email",
      due_at: "2026-10-24T21:00:00.000Z",
      status: "failed",
      error: "Outcome unknown; the send may or may not have gone out.",
    };
    const query = {
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        return query;
      }),
      eq: vi.fn((...args: unknown[]) => {
        filters.push(args);
        return query;
      }),
      lte: vi.fn((...args: unknown[]) => {
        filters.push(args);
        return query;
      }),
      select: vi.fn(async () => ({ data: [stale], error: null })),
    };
    supabaseMocks.getServiceClientOrNull.mockReturnValue({ from: () => query });

    const result = await reapStaleEmailClaims(
      new Date("2026-10-24T22:00:00.000Z"),
    );

    expect(result).toEqual([expect.objectContaining(stale)]);
    expect(updates).toEqual([{
      status: "failed",
      error: "Outcome unknown; the send may or may not have gone out.",
    }]);
    expect(filters).toContainEqual(["sending_at", "2026-10-24T21:30:00.000Z"]);
  });

  it("reschedules a guarded email claim 15 minutes later and increments attempts", async () => {
    let update: Record<string, unknown> | null = null;
    const filters: unknown[][] = [];
    const query = {
      update: vi.fn((payload: Record<string, unknown>) => {
        update = payload;
        return query;
      }),
      eq: vi.fn((...args: unknown[]) => {
        filters.push(args);
        return query;
      }),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: { id: "followup-1" }, error: null })),
    };
    supabaseMocks.getServiceClientOrNull.mockReturnValue({ from: () => query });

    await expect(rescheduleFollowup(
      "followup-1",
      1,
      "rate limited",
      new Date("2026-10-24T22:00:00.000Z"),
    )).resolves.toBe(true);

    expect(update).toEqual({
      status: "scheduled",
      due_at: "2026-10-24T22:15:00.000Z",
      attempts: 2,
      sending_at: null,
      error: "rate limited",
    });
    expect(filters).toContainEqual(["status", "sending"]);
    expect(filters).toContainEqual(["attempts", 1]);
  });
});
