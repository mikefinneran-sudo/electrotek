// Google Sheets API helpers for the Tiller connector (service-account JWT).
// Uses native fetch + node:crypto — no googleapis dependency.

import "server-only";
import { createSign } from "node:crypto";
import { isDemo, logDemoSideEffect } from "@waltersignal/bananaforce-core/demo";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

function parseServiceAccount(json: string): ServiceAccountKey | null {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof parsed.client_email === "string" &&
      typeof parsed.private_key === "string"
    ) {
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function signJwt(sa: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(sa.private_key);
  return `${unsigned}.${base64url(signature)}`;
}

export async function getGoogleAccessToken(
  serviceAccountJson: string,
): Promise<string | null> {
  if (isDemo()) {
    logDemoSideEffect("google-sheets.token");
    return null;
  }
  const sa = parseServiceAccount(serviceAccountJson);
  if (!sa) return null;

  const jwt = signJwt(sa);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
  };
  return typeof body.access_token === "string" ? body.access_token : null;
}

export async function appendSheetRows(
  accessToken: string,
  sheetId: string,
  tabName: string,
  rows: string[][],
): Promise<{ ok: boolean; rowsAppended?: number; error?: string }> {
  if (isDemo()) {
    logDemoSideEffect("google-sheets.append", { sheetId });
    return { ok: false, error: "Google Sheets is disabled in demo mode." };
  }
  if (rows.length === 0) {
    return { ok: true, rowsAppended: 0 };
  }

  // spreadsheets.values.append exposes no idempotency-key parameter or header
  // (https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append).
  // The Tiller connector therefore sends the outbox key as column G instead.
  const range = encodeURIComponent(`'${tabName.replace(/'/g, "''")}'!A:G`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: rows }),
  }).catch(() => null);

  if (!response) {
    return { ok: false, error: "Could not reach Google Sheets." };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      error: text.slice(0, 500) || `Sheets API returned ${response.status}.`,
    };
  }

  const body = (await response.json().catch(() => ({}))) as {
    updates?: { updatedRows?: number };
  };
  return {
    ok: true,
    rowsAppended: body.updates?.updatedRows ?? rows.length,
  };
}

export function isGoogleSheetsEnvConfigured(): boolean {
  return !isDemo() && Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export function tillerExportTabName(): string {
  return process.env.TILLER_EXPORT_TAB?.trim() || "BananaFORCE Export";
}

/** The platform service account a client must share their Tiller sheet with. */
export function serviceAccountEmail(): string | null {
  if (isDemo()) return null;
  return (
    parseServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "")
      ?.client_email ?? null
  );
}

/**
 * Confirms the service account can open the sheet, then adds the export tab
 * with its header row when the tab is missing.
 */
export async function ensureExportTab(
  accessToken: string,
  sheetId: string,
  tabName: string,
  headers: string[],
): Promise<
  | { ok: true; title: string; created: boolean }
  | { ok: false; denied: boolean; error: string }
> {
  if (isDemo()) {
    logDemoSideEffect("google-sheets.ensure-tab", { sheetId });
    return { ok: false, denied: false, error: "Google Sheets is disabled in demo mode." };
  }
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  const auth = { Authorization: `Bearer ${accessToken}` };

  const meta = await fetch(
    `${base}?fields=properties.title,sheets.properties.title`,
    { headers: auth },
  ).catch(() => null);
  if (!meta) {
    return { ok: false, denied: false, error: "Could not reach Google Sheets." };
  }
  if (meta.status === 403 || meta.status === 404) {
    return { ok: false, denied: true, error: `Sheets API returned ${meta.status}.` };
  }
  if (!meta.ok) {
    return { ok: false, denied: false, error: `Sheets API returned ${meta.status}.` };
  }

  const body = (await meta.json().catch(() => ({}))) as {
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const title = body.properties?.title ?? "Untitled spreadsheet";
  if (body.sheets?.some((sheet) => sheet.properties?.title === tabName)) {
    return { ok: true, title, created: false };
  }

  const add = await fetch(`${base}:batchUpdate`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: tabName } } }],
    }),
  }).catch(() => null);
  if (!add?.ok) {
    // Read-only (Viewer) shares fail here rather than on the metadata read.
    const denied = add?.status === 403;
    return {
      ok: false,
      denied,
      error: `Could not add the "${tabName}" tab${add ? ` (Sheets API ${add.status})` : ""}.`,
    };
  }

  const header = await appendSheetRows(accessToken, sheetId, tabName, [headers]);
  if (!header.ok) {
    return { ok: false, denied: false, error: header.error ?? "Could not write headers." };
  }
  return { ok: true, title, created: true };
}
