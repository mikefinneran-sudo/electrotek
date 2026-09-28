import assert from "node:assert/strict";
import {
  CONTENT_TYPE_TO_EXT,
  calcVisitStatus,
  generateChecklistItems,
  matchLineToLibrary,
  parseFrequencyDetail,
} from "./visit";
import type { TaskLibraryEntry } from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// --- calcVisitStatus: complete ------------------------------------------
{
  const r = calcVisitStatus([
    { done: true },
    { done: true },
    { done: true },
  ]);
  check(
    r.status === "complete" && r.tasksDone === 3 && r.tasksTotal === 3,
    "all done -> complete (3/3)",
  );
}

// --- calcVisitStatus: partial -------------------------------------------
{
  const r = calcVisitStatus([{ done: true }, { done: false }, { done: true }]);
  check(
    r.status === "partial" && r.tasksDone === 2 && r.tasksTotal === 3,
    "some done -> partial (2/3)",
  );
}

// --- calcVisitStatus: issue (none done) ---------------------------------
{
  const r = calcVisitStatus([{ done: false }, { done: false }]);
  check(
    r.status === "issue" && r.tasksDone === 0 && r.tasksTotal === 2,
    "none done -> issue (0/2)",
  );
}

// --- calcVisitStatus: zero active tasks is an issue ----------------------
{
  const r = calcVisitStatus([]);
  check(
    r.status === "issue" && r.tasksDone === 0 && r.tasksTotal === 0,
    "empty checklist -> issue (0/0), never complete",
  );
}

// --- calcVisitStatus: inactive items are excluded from the tally --------
{
  const r = calcVisitStatus([
    { done: true },
    { done: false, active: false },
    { done: true },
  ]);
  check(
    r.status === "complete" && r.tasksDone === 2 && r.tasksTotal === 2,
    "inactive items drop out of the tally (active 2/2 -> complete)",
  );
}

// --- keyword match helpers ----------------------------------------------
const library: TaskLibraryEntry[] = [
  {
    task_name: "Clean and sanitize restrooms",
    default_frequency: "Daily",
    area: "Restrooms",
    match_keywords: "restroom|bathroom|toilet|restrooms",
    sort_order: 20,
    always_include: false,
  },
  {
    task_name: "Vacuum carpets and rugs",
    default_frequency: "3×/week",
    area: "General",
    match_keywords: "vacuum|carpet|rugs",
    sort_order: 40,
    always_include: false,
  },
  {
    task_name: "Secure building on exit — lock confirmed",
    default_frequency: "Per Visit",
    area: "Security",
    match_keywords: "lock|secure|exit|locked",
    sort_order: 900,
    always_include: true,
  },
];

check(
  matchLineToLibrary("Disinfect the bathroom daily", library)?.task_name ===
    "Clean and sanitize restrooms",
  "matchLineToLibrary hits 'bathroom' keyword",
);
check(
  matchLineToLibrary("Empty the dumpster", library) === null,
  "matchLineToLibrary returns null when no keyword matches",
);
check(
  matchLineToLibrary("VACUUM the lobby", library)?.task_name === "Vacuum carpets and rugs",
  "matchLineToLibrary is case-insensitive",
);

// --- generateChecklistItems: match + always-include + sort + dedupe -----
{
  const { items } = generateChecklistItems(
    "Vacuum carpets 3x/wk\nRestroom disinfection daily",
    library,
  );
  const names = items.map((i) => i.task);
  check(names.includes("Vacuum carpets and rugs"), "generated list includes matched vacuum task");
  check(names.includes("Clean and sanitize restrooms"), "generated list includes matched restroom task");
  check(
    names.includes("Secure building on exit — lock confirmed"),
    "always-include library entry is appended",
  );
  // sort_order ascending: restrooms(20) < vacuum(40) < secure(900).
  check(
    items[0].task === "Clean and sanitize restrooms" &&
      items[items.length - 1].task === "Secure building on exit — lock confirmed",
    "generated items are sorted by sort_order ascending",
  );
}

// --- generateChecklistItems: dedupe by task name ------------------------
{
  const { items } = generateChecklistItems(
    "restroom cleaning\nalso scrub the toilet",
    library,
  );
  const restroomCount = items.filter((i) => i.task === "Clean and sanitize restrooms").length;
  check(restroomCount === 1, "duplicate matches collapse to a single task row");
}

// --- generateChecklistItems: empty scope still yields always-include ----
{
  const { items, empty } = generateChecklistItems("", library);
  check(
    items.length === 1 && items[0].task === "Secure building on exit — lock confirmed",
    "empty scope yields only the always-include entry",
  );
  check(empty === false, "always-include entry means the result is not flagged empty");
}

// --- generateChecklistItems: explicit scope frequency is preserved ------
{
  const { items } = generateChecklistItems("Vacuum carpets 3x/week", library);
  const vacuum = items.find((i) => i.task === "Vacuum carpets and rugs");
  check(
    vacuum?.frequency === "3x/week",
    "explicit scope cadence overrides the library default frequency",
  );
  check(
    vacuum?.frequency_detail === "3x/week",
    "parsed cadence is recorded in frequency_detail",
  );
}

// --- generateChecklistItems: no explicit cadence falls back to library --
{
  const { items } = generateChecklistItems("Disinfect the bathroom", library);
  const restroom = items.find((i) => i.task === "Clean and sanitize restrooms");
  check(
    restroom?.frequency === "Daily" && restroom?.frequency_detail === null,
    "no explicit cadence keeps the library default and null detail",
  );
}

// --- generateChecklistItems: empty flag when nothing is generated -------
{
  const noAlwaysInclude: TaskLibraryEntry[] = [
    {
      task_name: "Vacuum carpets and rugs",
      default_frequency: "3×/week",
      area: "General",
      match_keywords: "vacuum|carpet|rugs",
      sort_order: 40,
      always_include: false,
    },
  ];
  const { items, empty } = generateChecklistItems("", noAlwaysInclude);
  check(
    items.length === 0 && empty === true,
    "empty scope + no always-include surfaces empty=true",
  );
}

// --- parseFrequencyDetail ------------------------------------------------
check(parseFrequencyDetail("Vacuum 3x/week") === "3x/week", "parses 3x/week cadence");
check(
  parseFrequencyDetail("Disinfect daily please")?.toLowerCase() === "daily",
  "parses 'daily' cadence",
);
check(parseFrequencyDetail("Just mop the floor") === null, "no cadence -> null");

// --- CONTENT_TYPE_TO_EXT mapping (pure) ---------------------------------
check(CONTENT_TYPE_TO_EXT["image/jpeg"] === "jpg", "jpeg -> jpg");
check(CONTENT_TYPE_TO_EXT["image/png"] === "png", "png -> png");
check(CONTENT_TYPE_TO_EXT["image/webp"] === "webp", "webp -> webp");
check(
  (CONTENT_TYPE_TO_EXT["application/x-msdownload"] ?? "jpg") === "jpg",
  "unknown content-type falls back to jpg (no filename parsing)",
);

console.log(`visit tests passed (${passed})`);
