import type { ReceiptFieldProposal, ReceiptFields } from "./types";

/**
 * The shape is described in the prompt rather than enforced by a json_schema
 * response_format, because `json_object` is the mode every backend we target
 * (LiteLLM, vLLM, Ollama) supports. `normalizeReceiptResponse` is therefore the
 * real contract — it assumes nothing about what came back.
 */
export const RECEIPT_PROMPT = [
  "Extract the purchase fields from this receipt image.",
  "Respond with JSON only, in exactly this shape:",
  '{"vendor":{"value":string|null,"confidence":number},',
  '"purchased_on":{"value":string|null,"confidence":number},',
  '"total":{"value":number|null,"confidence":number},',
  '"tax":{"value":number|null,"confidence":number},',
  '"currency":{"value":string|null,"confidence":number}}',
  "",
  "confidence is 0 to 1, reflecting how clearly the value is legible.",
  "Use null for any field that is not present or not readable — do not guess.",
  "purchased_on must be ISO yyyy-mm-dd. Amounts are numbers in major currency",
  "units. currency is an ISO 4217 code such as USD.",
].join("\n");

function clamp(raw: unknown): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) return 0;
  return Math.min(1, Math.max(0, raw));
}

function readRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function stringField(raw: unknown): ReceiptFieldProposal<string> {
  const node = readRecord(raw);
  const value = typeof node.value === "string" && node.value.trim() ? node.value.trim() : null;
  return { value, confidence: value === null ? 0 : clamp(node.confidence) };
}

function moneyField(raw: unknown): ReceiptFieldProposal<number> {
  const node = readRecord(raw);
  const ok =
    typeof node.value === "number" && Number.isFinite(node.value) && node.value >= 0;
  return { value: ok ? (node.value as number) : null, confidence: ok ? clamp(node.confidence) : 0 };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateField(raw: unknown): ReceiptFieldProposal<string> {
  const node = readRecord(raw);
  const rawValue = typeof node.value === "string" ? node.value : null;
  let value: string | null = null;
  if (rawValue && ISO_DATE.test(rawValue)) {
    // The regex only proves the shape; round-trip through Date to prove the
    // date actually exists — "2026-13-45" and "2026-02-30" pass the regex
    // but must not survive here.
    const parsed = new Date(`${rawValue}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === rawValue) {
      value = rawValue;
    }
  }
  return { value, confidence: value === null ? 0 : clamp(node.confidence) };
}

/**
 * Turn a raw model response into proposals. Anything unparseable becomes a null
 * proposal with zero confidence — the operator then types it. A wrong value is
 * far worse than an empty one, so this never coerces.
 */
export function normalizeReceiptResponse(raw: unknown): ReceiptFields {
  const node = readRecord(raw);
  return {
    vendor: stringField(node.vendor),
    purchasedOn: dateField(node.purchased_on),
    total: moneyField(node.total),
    tax: moneyField(node.tax),
    currency: stringField(node.currency),
  };
}
