/** The only task this gateway performs. Widening it is a new decision. */
export type AiTask = "extract_receipt_fields";

export const AI_TASKS: readonly AiTask[] = ["extract_receipt_fields"];

/**
 * Points at any OpenAI-compatible `/chat/completions` endpoint — LiteLLM, vLLM,
 * Ollama, or a client's own provider. Both the endpoint and the key are env var
 * NAMES, so swapping WalterSignal's interim gateway for the client's own is an
 * environment change, not a code change.
 */
export interface AiConfig {
  /** NAME of the env var holding the base URL, e.g. "AI_GATEWAY_URL". */
  baseUrlEnvVar: string;
  /** NAME of the env var holding the key. Never the key itself. */
  apiKeyEnvVar: string;
  /** Model identifier as the configured gateway knows it. */
  model: string;
}

/**
 * Absent and misconfigured are deliberately distinct.
 *
 * - `absent`  — the client did not buy the feature. Silent by design.
 * - `misconfigured` — the block exists but cannot work. Never silent.
 * - `ready`   — usable; carries the resolved endpoint and key.
 */
export type AiConfigState =
  | { kind: "absent" }
  | { kind: "misconfigured"; reason: string }
  | { kind: "ready"; config: AiConfig; baseUrl: string; apiKey: string };

/** One model-proposed field value. Never written without operator confirmation. */
export interface ReceiptFieldProposal<T> {
  value: T | null;
  /** 0..1. Low values are flagged in the UI, not silently accepted. */
  confidence: number;
}

export interface ReceiptFields {
  vendor: ReceiptFieldProposal<string>;
  /** ISO yyyy-mm-dd. */
  purchasedOn: ReceiptFieldProposal<string>;
  /** Major currency units, e.g. 42.15. */
  total: ReceiptFieldProposal<number>;
  tax: ReceiptFieldProposal<number>;
  currency: ReceiptFieldProposal<string>;
}

export type RunAiTaskResult =
  | { ok: true; fields: ReceiptFields }
  | { ok: false; reason: "not-configured" }
  | { ok: false; reason: "misconfigured"; detail: string }
  | { ok: false; reason: "provider-error"; detail: string };

export interface ReceiptImage {
  /** Base64-encoded image bytes, no data: prefix, no newlines. */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}
