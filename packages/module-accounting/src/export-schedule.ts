// Plain-language export automation helpers. No I/O.

import type { ExportSchedule } from "./types";

export const EXPORT_SCHEDULES: readonly ExportSchedule[] = [
  "manual",
  "when_recorded",
  "daily",
  "weekly",
];

export interface ExportScheduleOption {
  value: ExportSchedule;
  label: string;
  description: string;
}

/** User-facing schedule choices for the accounting UI. */
export const EXPORT_SCHEDULE_OPTIONS: readonly ExportScheduleOption[] = [
  {
    value: "when_recorded",
    label: "When each payment or invoice is recorded",
    description:
      "Send to Tiller or Wave right after billing or ordering saves a transaction. Best for most businesses.",
  },
  {
    value: "daily",
    label: "Once a day (automatic)",
    description:
      "Batch export everything waiting in the queue every night. Good if you review books once per day.",
  },
  {
    value: "weekly",
    label: "Once a week (automatic)",
    description:
      "Batch export once per week when the scheduled job runs. Good for lighter bookkeeping.",
  },
  {
    value: "manual",
    label: "Manual only",
    description:
      "Nothing exports automatically. Use Export now when you are ready.",
  },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export function exportScheduleLabel(schedule: ExportSchedule): string {
  return (
    EXPORT_SCHEDULE_OPTIONS.find((option) => option.value === schedule)?.label ??
    schedule
  );
}

/** True when a new payment/invoice should trigger an immediate export attempt. */
export function shouldExportWhenRecorded(schedule: ExportSchedule): boolean {
  return schedule === "when_recorded";
}

/** True when the scheduled job should run a batch export now. */
export function isScheduledExportDue(
  schedule: ExportSchedule,
  lastAutomaticExportAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (schedule !== "daily" && schedule !== "weekly") {
    return false;
  }

  if (!lastAutomaticExportAt) {
    return true;
  }

  const lastMs = new Date(lastAutomaticExportAt).getTime();
  if (!Number.isFinite(lastMs)) {
    return true;
  }

  const elapsed = nowMs - lastMs;
  if (schedule === "daily") {
    return elapsed >= MS_PER_DAY;
  }
  return elapsed >= MS_PER_WEEK;
}
