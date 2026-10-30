import "server-only";

import {
  getServiceClientOrNull,
  warnSupabase,
} from "@waltersignal/bananaforce-data-supabase/server-helpers";
import { getContract } from "./server";

export type FollowupChannel = "email" | "text";
export type FollowupStatus =
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "canceled";

export interface ContractFollowup {
  id: string;
  contract_id: string;
  touch: number;
  channel: FollowupChannel;
  due_at: string;
  status: FollowupStatus;
  to_address: string | null;
  provider_id: string | null;
  error: string | null;
  attempts: number;
  sending_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface DueFollowup extends ContractFollowup {
  /** A stale text claim; the relay must check its ledger and chat.db before sending. */
  recovery: boolean;
}

export interface DueFollowups {
  claimed: DueFollowup[];
  canceled: ContractFollowup[];
}

export interface FollowupResult {
  channel: FollowupChannel;
  status: "sent" | "failed";
  providerId?: string | null;
  error?: string | null;
  toAddress?: string | null;
}

const MODULE_LABEL = "Contract follow-ups";
export const FOLLOWUP_TIME_ZONE = "America/Indiana/Indianapolis";
export const FOLLOWUP_LOCAL_HOUR = 18;
export const FOLLOWUP_TOUCH_OFFSETS_DAYS = [0, 3, 7, 11] as const;
const DEFAULT_FIRST_DELAY_DAYS = 3;
const STALE_SENDING_MS = 60 * 60 * 1000;
const STALE_EMAIL_SENDING_MS = 30 * 60 * 1000;
const EMAIL_RETRY_DELAY_MS = 15 * 60 * 1000;
const DUE_LIMIT = 50;
const SUPERSEDED_ERROR = "Superseded by a later touch.";
const STALE_EMAIL_ERROR = "Outcome unknown; the send may or may not have gone out.";

type Row = Record<string, unknown>;

const getServiceClient = (operation: string) =>
  getServiceClientOrNull(MODULE_LABEL, operation);

const warn = (operation: string, error: unknown) =>
  warnSupabase(MODULE_LABEL, operation, error);

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function followupFromRow(row: Row): ContractFollowup {
  return {
    id: stringOrNull(row.id) ?? "",
    contract_id: stringOrNull(row.contract_id) ?? "",
    touch: Number(row.touch),
    channel: row.channel === "text" ? "text" : "email",
    due_at: stringOrNull(row.due_at) ?? "",
    status: String(row.status) as FollowupStatus,
    to_address: stringOrNull(row.to_address),
    provider_id: stringOrNull(row.provider_id),
    error: stringOrNull(row.error),
    attempts: Number(row.attempts ?? 0),
    sending_at: stringOrNull(row.sending_at),
    sent_at: stringOrNull(row.sent_at),
    created_at: stringOrNull(row.created_at) ?? "",
  };
}

const localFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: FOLLOWUP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid follow-up date.");
  const parts = Object.fromEntries(
    localFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Convert an unambiguous local evening wall time to its UTC instant. */
function localEvening(year: number, month: number, day: number): Date {
  const target = Date.UTC(year, month - 1, day, FOLLOWUP_LOCAL_HOUR, 0, 0);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = localParts(new Date(candidate));
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate += target - represented;
  }
  return new Date(candidate);
}

function localDatePlusDays(base: Date, days: number): Date {
  const local = localParts(base);
  const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return localEvening(
    calendar.getUTCFullYear(),
    calendar.getUTCMonth() + 1,
    calendar.getUTCDate(),
  );
}

/** First reminder: three local calendar days after the invite, at 18:00. */
export function defaultSignatureFollowupFirstAt(inviteSentAt: Date): Date {
  return localDatePlusDays(inviteSentAt, DEFAULT_FIRST_DELAY_DAYS);
}

/** Four local-evening due times, preserving 18:00 across DST changes. */
export function signatureFollowupDueDates(firstAt: Date): Date[] {
  return FOLLOWUP_TOUCH_OFFSETS_DAYS.map((days) => localDatePlusDays(firstAt, days));
}

function firstName(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] || "there";
}

/** The single text template used by every relay job. */
export function signatureReminderText(input: {
  signerName: string | null | undefined;
  title: string | null | undefined;
  touch: number;
  signUrl: string;
}): string {
  const title = input.title?.trim() || "agreement";
  return `Hey ${firstName(input.signerName)}, quick reminder that your ${title} is waiting on your signature. It takes a couple minutes on your phone: ${input.signUrl}\n\nMike`;
}

/** Stable text before the fresh token URL, used only for chat.db recovery checks. */
export function signatureReminderCheckPrefix(body: string): string {
  const urlAt = body.indexOf("http");
  return urlAt < 0 ? body : body.slice(0, urlAt);
}

export async function scheduleSignatureFollowups(
  contractId: string,
  options: { firstAt?: Date; texts?: boolean } = {},
): Promise<boolean> {
  const contract = await getContract(contractId);
  if (!contract || contract.status !== "sent" || contract.signed_at) return false;

  const inviteSentAt = contract.sign_invite_sent_at
    ? new Date(contract.sign_invite_sent_at)
    : null;
  if (!options.firstAt && (!inviteSentAt || !Number.isFinite(inviteSentAt.getTime()))) {
    return false;
  }

  const supabase = getServiceClient("scheduleSignatureFollowups");
  if (!supabase) return false;
  const texts = options.texts ?? contract.followup_texts === true;
  const firstAt = options.firstAt ?? defaultSignatureFollowupFirstAt(inviteSentAt!);
  const dueDates = signatureFollowupDueDates(firstAt);

  if (options.texts !== undefined && options.texts !== contract.followup_texts) {
    const { error } = await supabase
      .from("contracts")
      .update({ followup_texts: options.texts })
      .eq("id", contractId);
    if (error) {
      warn("scheduleSignatureFollowups(opt-in)", error);
      return false;
    }
  }

  const rows = dueDates.flatMap((dueAt, index) => {
    const email = {
      contract_id: contractId,
      touch: index + 1,
      channel: "email" as const,
      due_at: dueAt.toISOString(),
      to_address: contract.signer_email?.trim() || null,
    };
    return texts
      ? [email, { ...email, channel: "text" as const, to_address: null }]
      : [email];
  });
  const { error } = await supabase
    .from("contract_followups")
    .upsert(rows, {
      onConflict: "contract_id,touch,channel",
      ignoreDuplicates: true,
    });
  if (error) {
    warn("scheduleSignatureFollowups", error);
    return false;
  }
  return true;
}

/** Cancel every unsent touch and return only rows changed by this call. */
export async function cancelFollowups(
  contractId: string,
  reason = "Contract is no longer awaiting signature.",
  channel?: FollowupChannel,
): Promise<ContractFollowup[]> {
  const supabase = getServiceClient("cancelFollowups");
  if (!supabase) return [];
  let query = supabase
    .from("contract_followups")
    .update({ status: "canceled", error: reason.slice(0, 1000) })
    .eq("contract_id", contractId);
  if (channel) query = query.eq("channel", channel);
  const { data, error } = await query
    .in("status", ["scheduled", "sending"])
    .select("*");
  if (error) {
    warn("cancelFollowups", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(followupFromRow);
}

/**
 * Atomically claim due work. Stale text claims are returned as recovery jobs
 * without changing their original sending_at.
 */
export async function dueFollowups(
  channel: FollowupChannel,
  now = new Date(),
): Promise<DueFollowups> {
  const empty = { claimed: [], canceled: [] };
  if (!Number.isFinite(now.getTime())) return empty;
  const localHour = localParts(now).hour;
  if (localHour < 9 || localHour > 20) return empty;

  const supabase = getServiceClient("dueFollowups");
  if (!supabase) return empty;
  const nowIso = now.toISOString();
  const { data, error } = await supabase
    .from("contract_followups")
    .select("*")
    .eq("channel", channel)
    .eq("status", "scheduled")
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(DUE_LIMIT);
  if (error) {
    warn("dueFollowups(list)", error);
    return empty;
  }

  const groups = new Map<string, Row[]>();
  for (const row of (data ?? []) as Row[]) {
    const key = `${stringOrNull(row.contract_id) ?? ""}\u0000${stringOrNull(row.channel) ?? channel}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const claimed: DueFollowup[] = [];
  const canceled: ContractFollowup[] = [];
  for (const rows of groups.values()) {
    const [winner, ...superseded] = rows.sort(
      (left, right) => Number(right.touch) - Number(left.touch),
    );
    for (const row of superseded) {
      const id = stringOrNull(row.id);
      if (!id) continue;
      const { data: canceledRow, error: cancelError } = await supabase
        .from("contract_followups")
        .update({ status: "canceled", error: SUPERSEDED_ERROR })
        .eq("id", id)
        .eq("status", "scheduled")
        .select("*")
        .maybeSingle();
      if (cancelError) {
        warn("dueFollowups(cancel superseded)", cancelError);
      } else if (canceledRow) {
        canceled.push(followupFromRow(canceledRow as Row));
      }
    }

    const row = winner;
    const id = stringOrNull(row.id);
    if (!id) continue;
    const { data: claimedRow, error: claimError } = await supabase
      .from("contract_followups")
      .update({ status: "sending", sending_at: nowIso, error: null })
      .eq("id", id)
      .eq("status", "scheduled")
      .select("*")
      .maybeSingle();
    if (claimError) {
      warn("dueFollowups(claim)", claimError);
      continue;
    }
    if (claimedRow) {
      claimed.push({ ...followupFromRow(claimedRow as Row), recovery: false });
    }
  }

  if (channel !== "text" || claimed.length >= DUE_LIMIT) {
    return { claimed, canceled };
  }
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS).toISOString();
  const { data: stale, error: staleError } = await supabase
    .from("contract_followups")
    .select("*")
    .eq("channel", "text")
    .eq("status", "sending")
    .lte("sending_at", staleBefore)
    .order("sending_at", { ascending: true })
    .limit(DUE_LIMIT - claimed.length);
  if (staleError) {
    warn("dueFollowups(recovery)", staleError);
    return { claimed, canceled };
  }
  return {
    claimed: [
      ...claimed,
      ...((stale ?? []) as Row[]).map((row) => ({
        ...followupFromRow(row),
        recovery: true,
      })),
    ],
    canceled,
  };
}

/** Fail closed when an email claim's outcome is no longer knowable. */
export async function reapStaleEmailClaims(
  now = new Date(),
): Promise<ContractFollowup[]> {
  const supabase = getServiceClient("reapStaleEmailClaims");
  if (!supabase || !Number.isFinite(now.getTime())) return [];
  const staleBefore = new Date(now.getTime() - STALE_EMAIL_SENDING_MS).toISOString();
  const { data, error } = await supabase
    .from("contract_followups")
    .update({ status: "failed", error: STALE_EMAIL_ERROR })
    .eq("channel", "email")
    .eq("status", "sending")
    .lte("sending_at", staleBefore)
    .select("*");
  if (error) {
    warn("reapStaleEmailClaims", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(followupFromRow);
}

/** Retry a provider-confirmed email failure without exposing it as terminal. */
export async function rescheduleFollowup(
  id: string,
  attempts: number,
  error: string,
  now = new Date(),
): Promise<boolean> {
  const supabase = getServiceClient("rescheduleFollowup");
  if (!supabase || !Number.isFinite(now.getTime())) return false;
  const { data, error: updateError } = await supabase
    .from("contract_followups")
    .update({
      status: "scheduled",
      due_at: new Date(now.getTime() + EMAIL_RETRY_DELAY_MS).toISOString(),
      attempts: attempts + 1,
      sending_at: null,
      error: error.slice(0, 1000),
    })
    .eq("id", id)
    .eq("status", "sending")
    .eq("attempts", attempts)
    .select("id")
    .maybeSingle();
  if (updateError) warn("rescheduleFollowup", updateError);
  return Boolean(data);
}

export async function setFollowupAddress(id: string, toAddress: string): Promise<boolean> {
  const supabase = getServiceClient("setFollowupAddress");
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("contract_followups")
    .update({ to_address: toAddress })
    .eq("id", id)
    .eq("status", "sending")
    .select("id")
    .maybeSingle();
  if (error) warn("setFollowupAddress", error);
  return Boolean(data);
}

/** Record one terminal provider result; replays are no-ops. */
export async function recordFollowupResult(
  id: string,
  result: FollowupResult,
): Promise<ContractFollowup | null> {
  const supabase = getServiceClient("recordFollowupResult");
  if (!supabase) return null;
  const sent = result.status === "sent";
  const { data, error } = await supabase
    .from("contract_followups")
    .update({
      status: result.status,
      provider_id: result.providerId?.slice(0, 500) || null,
      error: sent ? null : (result.error?.slice(0, 1000) || "Delivery failed."),
      sent_at: sent ? new Date().toISOString() : null,
      ...(result.toAddress ? { to_address: result.toAddress.slice(0, 500) } : {}),
    })
    .eq("id", id)
    .eq("channel", result.channel)
    .eq("status", "sending")
    .select("*")
    .maybeSingle();
  if (error) {
    warn("recordFollowupResult", error);
    return null;
  }
  return data ? followupFromRow(data as Row) : null;
}
