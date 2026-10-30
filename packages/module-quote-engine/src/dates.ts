// Dates shown to a customer are the BUSINESS's calendar dates, not UTC's. A
// quote sent at 11pm in Fort Wayne is already "tomorrow" in UTC; printing that
// date makes "Issued" a day ahead of the day the contractor actually sent it.

/** Default business time zone. Callers may pass another IANA zone. */
export const BUSINESS_TIME_ZONE = "America/Indiana/Indianapolis";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` for `value` as seen on the wall calendar in `timeZone`. */
export function businessDateIso(
  value: Date | string,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * "October 19, 2026". A date-only value (valid_until) is a calendar day already
 * and is not shifted; a timestamp is converted into `timeZone` first.
 */
export function formatBusinessDateLong(
  value: string | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (!value) return "—";
  const iso = businessDateIso(String(value), timeZone);
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
