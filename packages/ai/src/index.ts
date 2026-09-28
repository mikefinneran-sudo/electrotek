import type { AiConfig, AiConfigState } from "./types";

export type {
  AiConfig,
  AiConfigState,
  AiTask,
  ReceiptFieldProposal,
  ReceiptFields,
  ReceiptImage,
  RunAiTaskResult,
} from "./types";
export { AI_TASKS } from "./types";

/**
 * Classify the client's AI configuration.
 *
 * The distinction this function exists to draw: a client with no `ai` block did
 * not buy the feature, and that must stay silent so CI and preview builds are
 * green without a gateway. A client WITH a block that cannot work is broken, and
 * that must never be mistaken for "switched off".
 */
export function aiConfigState(config: AiConfig | undefined): AiConfigState {
  if (!config) return { kind: "absent" };

  if (!config.model.trim()) {
    return { kind: "misconfigured", reason: "ai.model is required" };
  }
  if (!config.baseUrlEnvVar.trim()) {
    return { kind: "misconfigured", reason: "ai.baseUrlEnvVar is required" };
  }
  if (!config.apiKeyEnvVar.trim()) {
    return { kind: "misconfigured", reason: "ai.apiKeyEnvVar is required" };
  }

  const baseUrl = process.env[config.baseUrlEnvVar];
  if (!baseUrl || !baseUrl.trim()) {
    return {
      kind: "misconfigured",
      reason: `ai.baseUrlEnvVar names "${config.baseUrlEnvVar}", which is not set in this environment`,
    };
  }

  try {
    new URL(baseUrl);
  } catch {
    return {
      kind: "misconfigured",
      reason: `${config.baseUrlEnvVar} is not a valid URL`,
    };
  }

  const apiKey = process.env[config.apiKeyEnvVar];
  if (!apiKey || !apiKey.trim()) {
    return {
      kind: "misconfigured",
      reason: `ai.apiKeyEnvVar names "${config.apiKeyEnvVar}", which is not set in this environment`,
    };
  }

  return { kind: "ready", config, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() };
}

/** True only when a task can actually run. False means OFF, never BROKEN. */
export function isAiConfigured(config: AiConfig | undefined): boolean {
  return aiConfigState(config).kind === "ready";
}
