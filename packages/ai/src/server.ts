import "server-only";
import { aiConfigState } from "./index";
import { extractReceiptFields } from "./chat-completions";
import type { AiConfig, AiTask, ReceiptImage, RunAiTaskResult } from "./types";

/**
 * The single entry point for every AI feature. Modules never construct a
 * provider client themselves.
 *
 * This function PROPOSES. It never writes, and its output must land in a draft
 * that an operator confirms before it becomes a record.
 */
export async function runAiTask(
  task: AiTask,
  input: ReceiptImage,
  config: AiConfig | undefined,
): Promise<RunAiTaskResult> {
  const state = aiConfigState(config);

  // Absent is legitimate — the client did not buy the feature.
  if (state.kind === "absent") return { ok: false, reason: "not-configured" };

  // Misconfigured is broken, and must never be mistaken for switched off.
  if (state.kind === "misconfigured") {
    return { ok: false, reason: "misconfigured", detail: state.reason };
  }

  if (task !== "extract_receipt_fields") {
    return { ok: false, reason: "misconfigured", detail: `unknown ai task "${task}"` };
  }

  const result = await extractReceiptFields(
    state.config,
    state.baseUrl,
    state.apiKey,
    input,
  );
  return result.ok
    ? { ok: true, fields: result.fields }
    : { ok: false, reason: "provider-error", detail: result.detail };
}
