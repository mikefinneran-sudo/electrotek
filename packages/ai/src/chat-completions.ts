import "server-only";
import { RECEIPT_PROMPT, normalizeReceiptResponse } from "./receipt";
import type { AiConfig, ReceiptFields, ReceiptImage } from "./types";

const TIMEOUT_MS = 60_000;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/**
 * One POST to an OpenAI-compatible /chat/completions endpoint. Works unchanged
 * against LiteLLM, vLLM, Ollama, or a client's own provider — which is the
 * point: the deploy target is configuration, not a code dependency.
 */
export async function extractReceiptFields(
  config: AiConfig,
  baseUrl: string,
  apiKey: string,
  image: ReceiptImage,
): Promise<{ ok: true; fields: ReceiptFields } | { ok: false; detail: string }> {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2000,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${image.mediaType};base64,${image.data}` },
              },
              { type: "text", text: RECEIPT_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      // Read the body for the gateway's own message — LiteLLM budget
      // exhaustion arrives as a 429 and is worth surfacing verbatim.
      const body = await response.text().catch(() => "");
      const detail = body.slice(0, 300) || response.statusText;
      return { ok: false, detail: `Gateway returned ${response.status}: ${detail}` };
    }

    let payload: ChatCompletionResponse;
    try {
      payload = (await response.json()) as ChatCompletionResponse;
    } catch {
      return { ok: false, detail: "The gateway returned a malformed response body." };
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return { ok: false, detail: "The gateway returned no message content." };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, detail: "The model returned unparseable JSON." };
    }

    return { ok: true, fields: normalizeReceiptResponse(parsed) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, detail: "The gateway did not respond within 60 seconds." };
    }
    return { ok: false, detail: `Could not reach the AI gateway at ${endpoint}.` };
  } finally {
    clearTimeout(timeout);
  }
}
