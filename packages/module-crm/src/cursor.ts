export interface KeysetCursor {
  createdAt: string;
  id: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidCursor(cursor: unknown): cursor is KeysetCursor {
  if (typeof cursor !== "object" || cursor === null) return false;
  const maybe = cursor as Partial<KeysetCursor>;
  if (typeof maybe.createdAt !== "string" || typeof maybe.id !== "string") {
    return false;
  }
  if (!UUID_RE.test(maybe.id)) return false;
  return ISO_TIMESTAMP_RE.test(maybe.createdAt) && !Number.isNaN(Date.parse(maybe.createdAt));
}

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeKeysetCursor(value: string | null | undefined): KeysetCursor | null {
  if (!value) return null;

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return isValidCursor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
