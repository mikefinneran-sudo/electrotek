export function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Record types a `?new=` link can open a create form for, and the tab each form lives on. */
const NEW_RECORD_TABS = { account: "accounts", opportunity: "pipeline", case: "cases", contact: "contacts" } as const;
export type NewRecord = keyof typeof NEW_RECORD_TABS;

/** Resolves a `?new=account` (etc.) value; null when absent, unknown, or its tab is not shown. */
export function newRecordLink(
  kind: string | null | undefined,
  shown: readonly string[],
): { kind: NewRecord; tab: (typeof NEW_RECORD_TABS)[NewRecord] } | null {
  if (!kind || !Object.hasOwn(NEW_RECORD_TABS, kind)) return null;
  const tab = NEW_RECORD_TABS[kind as NewRecord];
  return shown.includes(tab) ? { kind: kind as NewRecord, tab } : null;
}

/** Splits note text into plain runs and link runs; only http(s) and obsidian:// URLs become links. */
export function linkParts(text: string): { text: string; href?: string }[] {
  return text
    .split(/((?:https?|obsidian):\/\/[^\s<>"]+)/)
    .filter(Boolean)
    .map((part) => (/^(?:https?|obsidian):\/\//.test(part) ? { text: part, href: part } : { text: part }));
}
