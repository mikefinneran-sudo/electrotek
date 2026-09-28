import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The gate that /cases failed.
 *
 * A screen shipped with 19 inline style props, zero design tokens, a raw
 * Material-red hex belonging to no palette in this repo, and six of evidence's
 * nineteen fields rendered. Typecheck passed. Fifty-nine tests passed. Nobody
 * had ever seen it with a row in it.
 *
 * These assertions are the part of that failure a machine can catch. The rest
 * — did anyone open it in a browser — lives in the replacement-fidelity skill,
 * because no test can look at a screen.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = readFileSync(join(HERE, "ui.tsx"), "utf8");
const TYPES = readFileSync(join(HERE, "types.ts"), "utf8");
const COVERAGE = JSON.parse(readFileSync(join(HERE, "field-coverage.json"), "utf8")) as Coverage;

interface CoverageEntry {
  shown: string[];
  dropped: { field: string; reason: string; approved_by: string }[];
}
type Coverage = Record<string, CoverageEntry>;

/** The interface backing each rendered section, and the section it feeds. */
const RENDERED: Record<string, string> = {
  evidence: "CaseEvidence",
  claimants: "CaseClaimant",
  participants: "CaseParticipant",
  depositions: "Deposition",
  time_entries: "CaseTimeEntry",
};

/**
 * Plumbing every record carries. It is not information a forensic engineer
 * reads off a screen, so it is exempt from coverage rather than dropped.
 */
const PLUMBING = new Set([
  "id",
  "legacy_id",
  "source_system",
  "created_at",
  "updated_at",
  "deleted_at",
  "case_id",
  "legacy_case_ref",
  "contact_id",
  "account_id",
  "staff_id",
  "legacy_staff_ref",
]);

/** The fields an interface declares itself, minus the plumbing it inherits. */
function fieldsOf(interfaceName: string): string[] {
  const match = TYPES.match(
    new RegExp(`export interface ${interfaceName}[^{]*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (match === null) throw new Error(`interface ${interfaceName} not found in types.ts`);
  return [...match[1].matchAll(/^\s{2}(\w+)[?]?:/gm)]
    .map((m) => m[1])
    .filter((name) => !PLUMBING.has(name));
}

describe("case file uses the ElectroTek design system", () => {
  it("carries no inline style props", () => {
    // apps/electrotek/app/globals.css defines 46 tokens. A style={{}} prop is a
    // decision made in spite of them.
    const inline = [...UI.matchAll(/style=\{\{/g)].length;
    expect(inline, `${inline} inline style props in ui.tsx; use globals.css classes`).toBe(0);
  });

  it("hard-codes no colors", () => {
    const hex = [...UI.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hex, `hard-coded colors: ${hex.join(", ")}; use var(--token)`).toEqual([]);
  });
});

describe("case file renders the fields the practice actually keeps", () => {
  for (const [section, interfaceName] of Object.entries(RENDERED)) {
    it(`accounts for every ${section} field`, () => {
      const declared = fieldsOf(interfaceName);
      const entry = COVERAGE[section];
      expect(entry, `field-coverage.json has no entry for ${section}`).toBeDefined();

      const accounted = new Set([...entry.shown, ...entry.dropped.map((d) => d.field)]);
      const unaccounted = declared.filter((name) => !accounted.has(name));
      expect(
        unaccounted,
        `${section} fields in neither shown nor dropped: ${unaccounted.join(", ")}`,
      ).toEqual([]);
    });

    it(`renders every ${section} field it claims to show`, () => {
      // A manifest that claims coverage the screen does not deliver is worse
      // than no manifest, so each claim is checked against the source.
      const missing = (COVERAGE[section]?.shown ?? []).filter(
        (name) => !new RegExp(`\\b${name}\\b`).test(UI),
      );
      expect(missing, `claimed shown but absent from ui.tsx: ${missing.join(", ")}`).toEqual([]);
    });

    it(`has a signed-off reason for every dropped ${section} field`, () => {
      // Without this, "dropped" is a rubber stamp and the gate is theatre.
      const unsigned = (COVERAGE[section]?.dropped ?? []).filter(
        (d) => d.approved_by.trim() === "" || d.reason.trim() === "",
      );
      expect(
        unsigned.map((d) => d.field),
        "dropped fields need a reason and a named approver",
      ).toEqual([]);
    });
  }
});
