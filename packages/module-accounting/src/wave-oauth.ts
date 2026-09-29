// Wave OAuth helpers. Wave Pro is required for third-party OAuth (since May 2025).

import "server-only";

const WAVE_AUTHORIZE_URL = "https://api.waveapps.com/oauth2/authorize/";
const WAVE_TOKEN_URL = "https://api.waveapps.com/oauth2/token/";
const WAVE_GRAPHQL_URL = "https://gql.waveapps.com/graphql/public";

const DEFAULT_SCOPES = [
  "account:read",
  "business:read",
  "customer:read",
  "customer:write",
  "invoice:read",
  "invoice:write",
  "user:read",
  "offline_access",
].join(" ");

export function isWaveOAuthEnvConfigured(): boolean {
  return (
    Boolean(process.env.WAVE_CLIENT_ID?.trim()) &&
    Boolean(process.env.WAVE_CLIENT_SECRET?.trim())
  );
}

export function buildWaveAuthorizeUrl(redirectUri: string, state: string): string | null {
  const clientId = process.env.WAVE_CLIENT_ID?.trim();
  if (!clientId) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DEFAULT_SCOPES,
    state,
  });
  return `${WAVE_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeWaveCode(
  code: string,
  redirectUri: string,
): Promise<Record<string, unknown> | null> {
  const clientId = process.env.WAVE_CLIENT_ID?.trim();
  const clientSecret = process.env.WAVE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  const response = await fetch(WAVE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return body;
}

export async function refreshWaveAccessToken(
  refreshToken: string,
  redirectUri: string,
): Promise<Record<string, unknown> | null> {
  const clientId = process.env.WAVE_CLIENT_ID?.trim();
  const clientSecret = process.env.WAVE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  const response = await fetch(WAVE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: redirectUri,
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  return (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
}

export async function waveGraphql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const response = await fetch(WAVE_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  }).catch(() => null);

  if (!response) {
    return { ok: false, error: "Could not reach Wave." };
  }

  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || body.errors?.length) {
    const msg =
      body.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `Wave returned ${response.status}.`;
    return { ok: false, error: msg.slice(0, 500) };
  }

  return { ok: true, data: body.data as T };
}

export async function fetchWaveBusinessId(
  accessToken: string,
): Promise<string | null> {
  const query = `
    query WaveBusinesses {
      businesses {
        edges {
          node {
            id
          }
        }
      }
    }
  `;

  const result = await waveGraphql<{
    businesses?: { edges?: Array<{ node?: { id?: string } }> };
  }>(accessToken, query);

  if (!result.ok) return null;
  const id = result.data.businesses?.edges?.[0]?.node?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export { WAVE_GRAPHQL_URL };
