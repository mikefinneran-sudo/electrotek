import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const moduleMigration = readFileSync(
  new URL("../supabase/migrations/0001_forensic_case.sql", import.meta.url),
  "utf8",
);
const aggregateMigration = readFileSync(
  new URL("../../../supabase/migrations/0056_forensic_case.sql", import.meta.url),
  "utf8",
);

const TABLES = [
  "case_evidence",
  "case_claimants",
  "addresses",
  "contact_methods",
  "case_participants",
  "depositions",
  "case_time_entries",
] as const;

describe("forensic-case migration", () => {
  it("keeps the module and aggregate copies byte-identical", () => {
    expect(aggregateMigration).toBe(moduleMigration);
  });

  it("does not mutate the CRM-owned cases table", () => {
    expect(moduleMigration).not.toMatch(/alter table public\.cases\b/i);
    expect(moduleMigration).not.toMatch(/create table if not exists public\.cases\b/i);
  });

  it("gives every table an import index, CRUD grant, RLS, and staff-all policy", () => {
    for (const table of TABLES) {
      expect(moduleMigration).toContain(`on public.${table} (source_system, legacy_id)`);
      expect(moduleMigration).toContain(
        `grant select, insert, update, delete on public.${table} to authenticated;`,
      );
      expect(moduleMigration).toContain(
        `alter table public.${table} enable row level security;`,
      );
      expect(moduleMigration).toMatch(
        new RegExp(`on public\\.${table} for all[\\s\\S]*?using \\(public\\.is_staff\\(\\)\\) with check \\(public\\.is_staff\\(\\)\\)`),
      );
    }
  });

  it("places Data API grants before RLS", () => {
    const firstGrant = moduleMigration.indexOf("grant select, insert, update, delete");
    const firstRls = moduleMigration.indexOf("enable row level security");
    expect(firstGrant).toBeGreaterThan(-1);
    expect(firstGrant).toBeLessThan(firstRls);
  });

  it("preserves evidence's nullable case/orphan path and string legacy reference", () => {
    expect(moduleMigration).toMatch(
      /create table if not exists public\.case_evidence[\s\S]*?case_id\s+uuid null references public\.cases\(id\) on delete set null/,
    );
    expect(moduleMigration).toMatch(/legacy_case_ref\s+text null/);
  });

  it("keeps time separate from expenses and admits legacy billing identities", () => {
    expect(moduleMigration).not.toMatch(/(?:create|alter) table .*public\.expenses\b/i);
    expect(moduleMigration).toContain("case_time_entries_staff_reference_present");
    expect(moduleMigration).toContain(
      "check (staff_id is not null or legacy_staff_ref is not null)",
    );
    expect(moduleMigration).toContain("case_time_entries_hours_non_negative");
  });
});
