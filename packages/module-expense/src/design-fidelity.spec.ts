import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The replacement-fidelity gates, applied to the expense screens: no inline
 * styles or hard-coded colours (globals.css carries the tokens), and every
 * field a record carries is either on screen or dropped with a signed reason.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, file), "utf8");
const SCREEN = ["ui.tsx", "views.tsx", "page.tsx"].map(read).join("\n");
const TYPES = read("types.ts");
const COVERAGE = JSON.parse(read("field-coverage.json")) as Record<
  string,
  { shown: string[]; dropped: { field: string; reason: string; approved_by: string }[] }
>;

const RENDERED: Record<string, string> = { expense: "Expense", report: "ExpenseReport" };

/**
 * Plumbing, not information: identifiers, timestamps the database manages,
 * the owner of an expense (always the viewer on their own screen), the report
 * link (the screen is organised by it), and confirmation audit columns, which
 * record the owner saving their own entry.
 */
const PLUMBING = new Set([
  "id",
  "legacy_id",
  "source_system",
  "created_at",
  "updated_at",
  "report_id",
  "confirmed_at",
  "confirmed_by",
]);

function fieldsOf(interfaceName: string, exempt: Set<string>): string[] {
  const match = TYPES.match(new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`));
  if (match === null) throw new Error(`interface ${interfaceName} not found in types.ts`);
  return [...match[1].matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]).filter((name) => !exempt.has(name));
}

describe("expense screens use the ElectroTek design system", () => {
  it("carry no inline style props", () => {
    expect([...SCREEN.matchAll(/style=\{\{/g)].length).toBe(0);
  });
  it("hard-code no colors", () => {
    expect([...SCREEN.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])).toEqual([]);
  });
});

describe("expense screens render the fields the records carry", () => {
  for (const [section, interfaceName] of Object.entries(RENDERED)) {
    // An expense's submitted_by is the viewer; a report's is shown to approvers.
    const exempt = new Set([...PLUMBING, ...(section === "expense" ? ["submitted_by"] : [])]);

    it(`accounts for every ${section} field`, () => {
      const entry = COVERAGE[section];
      const accounted = new Set([...entry.shown, ...entry.dropped.map((d) => d.field)]);
      const missing = fieldsOf(interfaceName, exempt).filter((name) => !accounted.has(name));
      expect(missing, `${section} fields in neither shown nor dropped`).toEqual([]);
    });

    it(`renders every ${section} field it claims to show`, () => {
      const absent = COVERAGE[section].shown.filter((name) => !new RegExp(`\\b${name}\\b`).test(SCREEN));
      expect(absent, "claimed shown but absent from the screen source").toEqual([]);
    });

    it(`signs every dropped ${section} field`, () => {
      const unsigned = COVERAGE[section].dropped.filter((d) => !d.reason.trim() || !d.approved_by.trim());
      expect(unsigned.map((d) => d.field)).toEqual([]);
    });
  }
});
