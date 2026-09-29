export type AttributeMap = Record<string, unknown>;

export function attributesRecord(value: unknown): AttributeMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AttributeMap;
}

export function attributeValue(row: AttributeMap, key: string): unknown {
  const attributes = attributesRecord(row.attributes);
  return Object.prototype.hasOwnProperty.call(attributes, key) ? attributes[key] : row[key];
}

export function attributePatchFromInput(
  input: AttributeMap,
  keys: readonly string[],
): AttributeMap {
  const patch: AttributeMap = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = input[key];
  }
  return patch;
}

export function mergeAttributes(existing: unknown, patch: AttributeMap): AttributeMap {
  return { ...attributesRecord(existing), ...patch };
}

export function hasAttributePatch(patch: AttributeMap): boolean {
  return Object.keys(patch).length > 0;
}

export function isMissingAttributesColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(err.code ?? "").toLowerCase();
  const text = `${String(err.message ?? "")} ${String(err.details ?? "")}`.toLowerCase();
  return (
    code === "42703" ||
    code === "pgrst204" ||
    (text.includes("attributes") && text.includes("column"))
  );
}
