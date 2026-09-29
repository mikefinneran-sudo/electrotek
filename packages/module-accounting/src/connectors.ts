// Ledger sync connectors. Each connector degrades gracefully when not configured.

import "server-only";
import {
  appendSheetRows,
  getGoogleAccessToken,
  isGoogleSheetsEnvConfigured,
  tillerExportTabName,
} from "./google-sheets";
import { buildTillerExportRow, tillerRowValues } from "./tiller-export";
import type {
  ConnectorName,
  LedgerEventType,
  LedgerOutboxEvent,
} from "./types";
import {
  decodeStoredCredentials,
  encodeStoredCredentials,
  isCredentialsEncryptionConfigured,
} from "./credentials";
import {
  isWaveOAuthEnvConfigured,
  refreshWaveAccessToken,
  waveGraphql,
} from "./wave-oauth";

export interface PushResult {
  ok: boolean;
  skipped?: boolean;
  recordsSynced?: number;
  error?: string;
}

export interface SyncResult {
  ok: boolean;
  skipped?: boolean;
  recordsSynced?: number;
  error?: string;
}

export interface AccountingConnector {
  name: ConnectorName;
  isConfigured(): boolean;
  pushEvent(event: LedgerOutboxEvent): Promise<PushResult>;
  sync(): Promise<SyncResult>;
}

type WaveCredentials = {
  access_token?: string;
  refresh_token?: string;
  business_id?: string;
  redirect_uri?: string;
};

async function loadWaveCredentials(
  loadFromDb: () => Promise<string | null>,
): Promise<WaveCredentials | null> {
  const blob = await loadFromDb();
  if (!blob) return null;
  const decoded = decodeStoredCredentials(blob);
  if (!decoded) return null;
  return decoded as WaveCredentials;
}

export function createTillerConnector(deps: {
  resolveCategory?: (
    eventType: LedgerEventType,
    defaultCategory: string,
  ) => Promise<string | undefined>;
}): AccountingConnector {
  return {
    name: "tiller",
    isConfigured: isTillerConfigured,
    async pushEvent(event): Promise<PushResult> {
      if (!isTillerConfigured()) {
        return { ok: false, skipped: true };
      }

      const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
      const sheetId = process.env.TILLER_SHEET_ID ?? "";
      const token = await getGoogleAccessToken(saJson);
      if (!token) {
        return { ok: false, error: "Could not authenticate to Google Sheets." };
      }

      const defaultCategory = buildTillerExportRow(
        event.event_type,
        event.source_module,
        event.source_id,
        event.payload,
      ).category;
      const categoryOverride = deps.resolveCategory
        ? await deps.resolveCategory(event.event_type, defaultCategory)
        : undefined;

      const row = {
        ...buildTillerExportRow(
          event.event_type,
          event.source_module,
          event.source_id,
          event.payload,
          categoryOverride,
        ),
        // Sheets append has no idempotency option; preserve the outbox key in
        // the exported row so a connector-side dedupe can identify retries.
        idempotencyKey: event.idempotency_key,
      };

      const result = await appendSheetRows(
        token,
        sheetId,
        tillerExportTabName(),
        [tillerRowValues(row)],
      );

      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      return { ok: true, recordsSynced: result.rowsAppended ?? 1 };
    },
    async sync(): Promise<SyncResult> {
      if (!isTillerConfigured()) {
        return { ok: false, skipped: true };
      }
      // Inbound Tiller reads (Transactions tab) deferred to Phase 3.
      return { ok: false, skipped: true };
    },
  };
}

export function createWaveConnector(deps: {
  loadCredentials: () => Promise<string | null>;
  saveCredentials: (blob: string) => Promise<boolean>;
}): AccountingConnector {
  return {
    name: "wave",
    isConfigured: isWaveOAuthEnvConfigured,
    async pushEvent(event): Promise<PushResult> {
      const credBlob = await deps.loadCredentials();
      if (!credBlob) {
        return { ok: false, skipped: true };
      }

      const creds = await loadWaveCredentials(deps.loadCredentials);
      if (!creds?.refresh_token || !creds.redirect_uri) {
        return { ok: false, skipped: true };
      }

      let accessToken =
        typeof creds.access_token === "string" ? creds.access_token : null;
      const refreshed = await refreshWaveAccessToken(
        creds.refresh_token,
        creds.redirect_uri,
      );
      if (
        refreshed?.access_token &&
        typeof refreshed.access_token === "string"
      ) {
        accessToken = refreshed.access_token;
        const merged = { ...creds, ...refreshed };
        const blob = encodeStoredCredentials(merged);
        if (blob) await deps.saveCredentials(blob);
      }

      if (!accessToken) {
        return { ok: false, error: "Could not refresh Wave access token." };
      }

      if (event.event_type === "payment.succeeded") {
        return pushWaveIncome(
          accessToken,
          typeof creds.business_id === "string" ? creds.business_id : undefined,
          event,
        );
      }

      if (event.event_type === "invoice.opened") {
        return pushWaveInvoice(
          accessToken,
          typeof creds.business_id === "string" ? creds.business_id : undefined,
          event,
        );
      }

      return { ok: false, skipped: true };
    },
    async sync(): Promise<SyncResult> {
      if (!isWaveOAuthEnvConfigured()) {
        return { ok: false, skipped: true };
      }
      const blob = await deps.loadCredentials();
      if (!blob) {
        return { ok: false, skipped: true };
      }
      return { ok: false, skipped: true };
    },
  };
}

async function pushWaveIncome(
  accessToken: string,
  businessId: string | undefined,
  event: LedgerOutboxEvent,
): Promise<PushResult> {
  const amount = event.payload.amount ?? 0;
  if (amount <= 0) {
    return { ok: false, error: "Payment amount missing for Wave income." };
  }

  const description =
    event.payload.description ??
    (event.payload.invoice_number
      ? `Payment — ${event.payload.invoice_number}`
      : `Payment — ${event.source_id}`);

  const mutation = `
    mutation RecordIncome($input: MoneyTransactionCreateInput!) {
      moneyTransactionCreate(input: $input) {
        didSucceed
        inputErrors { message path }
      }
    }
  `;

  const variables = {
    input: {
      businessId,
      // Wave accepts an externalId, so the outbox key reaches its native
      // duplicate-detection field rather than living only in our sync log.
      externalId: event.idempotency_key,
      date: new Date().toISOString().slice(0, 10),
      description: description.slice(0, 500),
      anchor: { accountId: null },
      lineItems: [
        {
          description: description.slice(0, 500),
          amount: amount.toFixed(2),
        },
      ],
    },
  };

  const result = await waveGraphql<{
    moneyTransactionCreate?: {
      didSucceed?: boolean;
      inputErrors?: Array<{ message?: string }>;
    };
  }>(accessToken, mutation, variables);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const create = result.data.moneyTransactionCreate;
  if (!create?.didSucceed) {
    const msg =
      create?.inputErrors?.map((e) => e.message).filter(Boolean).join("; ") ||
      "Wave rejected the income transaction.";
    return { ok: false, error: msg.slice(0, 500) };
  }

  return { ok: true, recordsSynced: 1 };
}

async function pushWaveInvoice(
  accessToken: string,
  businessId: string | undefined,
  event: LedgerOutboxEvent,
): Promise<PushResult> {
  const amount = event.payload.amount ?? 0;
  const invoiceNumber =
    event.payload.invoice_number ?? event.payload.invoice_id ?? event.source_id;

  const mutation = `
    mutation CreateInvoice($input: InvoiceCreateInput!) {
      invoiceCreate(input: $input) {
        didSucceed
        invoice { id }
        inputErrors { message path }
      }
    }
  `;

  const variables = {
    input: {
      businessId,
      // Wave accepts an externalId on invoices too.
      externalId: event.idempotency_key,
      invoiceNumber: String(invoiceNumber).slice(0, 100),
      items: [
        {
          description: event.payload.description ?? `Invoice ${invoiceNumber}`,
          quantity: 1,
          unitPrice: amount.toFixed(2),
        },
      ],
    },
  };

  const result = await waveGraphql<{
    invoiceCreate?: {
      didSucceed?: boolean;
      invoice?: { id?: string };
      inputErrors?: Array<{ message?: string }>;
    };
  }>(accessToken, mutation, variables);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const create = result.data.invoiceCreate;
  if (!create?.didSucceed) {
    const msg =
      create?.inputErrors?.map((e) => e.message).filter(Boolean).join("; ") ||
      "Wave rejected the invoice.";
    return { ok: false, error: msg.slice(0, 500) };
  }

  return { ok: true, recordsSynced: 1 };
}

/** Tiller: Google service account + sheet id. */
export function isTillerConfigured(): boolean {
  return isGoogleSheetsEnvConfigured();
}

/** Wave: OAuth app env vars present. */
export function isWaveEnvConfigured(): boolean {
  return isWaveOAuthEnvConfigured();
}

export async function waveConnectorStatus(
  loadCredentials: () => Promise<string | null>,
): Promise<boolean> {
  if (!isWaveOAuthEnvConfigured()) return false;
  return Boolean(await loadCredentials());
}

export function selectConnector(
  name: string,
  deps: {
    loadWaveCredentials: () => Promise<string | null>;
    saveWaveCredentials: (blob: string) => Promise<boolean>;
    resolveCategory?: (
      eventType: LedgerEventType,
      defaultCategory: string,
    ) => Promise<string | undefined>;
  },
): AccountingConnector | null {
  if (name === "tiller") {
    return createTillerConnector({ resolveCategory: deps.resolveCategory });
  }
  if (name === "wave") {
    return createWaveConnector({
      loadCredentials: deps.loadWaveCredentials,
      saveCredentials: deps.saveWaveCredentials,
    });
  }
  return null;
}

// Legacy stubs for manual sync button (backward compat).
export const tillerConnector = createTillerConnector({});
export const waveConnector = createWaveConnector({
  loadCredentials: async () => null,
  saveCredentials: async () => false,
});

export { isWaveOAuthEnvConfigured } from "./wave-oauth";
export { isCredentialsEncryptionConfigured };
