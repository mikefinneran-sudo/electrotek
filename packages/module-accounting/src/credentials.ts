// Encrypt/decrypt connector credentials at rest (Wave OAuth tokens).

import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function isCredentialsEncryptionConfigured(): boolean {
  return Boolean(process.env.CONNECTOR_CREDENTIALS_KEY?.trim());
}

export function encryptCredentials(
  payload: Record<string, unknown>,
): string | null {
  const secret = process.env.CONNECTOR_CREDENTIALS_KEY?.trim();
  if (!secret) return null;

  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptCredentials(
  blob: string,
): Record<string, unknown> | null {
  const secret = process.env.CONNECTOR_CREDENTIALS_KEY?.trim();
  if (!secret) return null;

  const parts = blob.split(".");
  if (parts.length !== 3) return null;

  const [ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) return null;

  try {
    const key = deriveKey(secret);
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function decodeCredentialsPlain(
  blob: string,
): Record<string, unknown> | null {
  if (!blob.startsWith("plain:")) return null;
  try {
    const json = Buffer.from(blob.slice("plain:".length), "base64url").toString(
      "utf8",
    );
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function decodeStoredCredentials(
  blob: string,
): Record<string, unknown> | null {
  // Fail closed on read too: with no encryption key configured we must NOT
  // silently decode legacy plaintext blobs (mirrors the locked-down write path).
  if (!isCredentialsEncryptionConfigured()) return null;
  return decryptCredentials(blob) ?? decodeCredentialsPlain(blob);
}

export function encodeStoredCredentials(
  payload: Record<string, unknown>,
): string | null {
  return encryptCredentials(payload);
}
