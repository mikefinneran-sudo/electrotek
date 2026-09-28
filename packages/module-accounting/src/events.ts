// Public entrypoint for other modules (billing, ordering) to enqueue ledger events.
// Never throws — callers (e.g. Stripe webhooks) must not fail because accounting is down.

import "server-only";
import { drainOutbox, enqueueLedgerEventInternal, isAccountingConfigured, shouldAutoExportOnRecord } from "./server";
import type {
  EnqueueLedgerEventInput,
  EnqueueLedgerEventResult,
  LedgerEventPayload,
  LedgerEventType,
} from "./types";

export type {
  EnqueueLedgerEventInput,
  EnqueueLedgerEventResult,
  LedgerEventPayload,
  LedgerEventType,
};

/** True when the service-role client is available for outbox writes. */
export function isLedgerEventsEnabled(): boolean {
  return isAccountingConfigured();
}

/** Batch size when schedule is `when_recorded`. */
export const AUTO_EXPORT_BATCH_SIZE = 10;

export async function enqueueLedgerEvent(
  input: EnqueueLedgerEventInput,
): Promise<EnqueueLedgerEventResult> {
  try {
    const result = await enqueueLedgerEventInternal(input);
    if (result.ok && !result.duplicate && (await shouldAutoExportOnRecord())) {
      await drainOutbox(AUTO_EXPORT_BATCH_SIZE).catch(() => undefined);
    }
    return result;
  } catch {
    return { ok: false, skipped: true };
  }
}

export { drainOutbox };
