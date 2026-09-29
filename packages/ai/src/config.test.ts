import assert from "node:assert/strict";
import { aiConfigState, isAiConfigured } from "./index";
import type { AiConfig } from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

function withEnv(name: string, value: string | undefined, run: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

const valid: AiConfig = {
  baseUrlEnvVar: "AI_GATEWAY_URL",
  apiKeyEnvVar: "AI_GATEWAY_KEY",
  model: "qwen3.5-122b",
};

function withGateway(run: () => void): void {
  withEnv("AI_GATEWAY_URL", "http://127.0.0.1:4000/v1", () =>
    withEnv("AI_GATEWAY_KEY", "sk-test", run),
  );
}

// --- absent: legitimate, silent -----------------------------------------------

check(aiConfigState(undefined).kind === "absent", "no ai block is absent");
check(isAiConfigured(undefined) === false, "absent is not configured");

// --- misconfigured: structural ------------------------------------------------

withGateway(() => {
  check(
    aiConfigState({ ...valid, model: "  " }).kind === "misconfigured",
    "blank model is misconfigured",
  );
  check(
    aiConfigState({ ...valid, apiKeyEnvVar: "" }).kind === "misconfigured",
    "blank apiKeyEnvVar is misconfigured",
  );
  check(
    aiConfigState({ ...valid, baseUrlEnvVar: "" }).kind === "misconfigured",
    "blank baseUrlEnvVar is misconfigured",
  );
});

// --- misconfigured: runtime (env var named but unset) -------------------------

withEnv("AI_GATEWAY_URL", "http://127.0.0.1:4000/v1", () => {
  withEnv("AI_GATEWAY_KEY", undefined, () => {
    const state = aiConfigState(valid);
    check(state.kind === "misconfigured", "named-but-unset key var is misconfigured");
    check(
      state.kind === "misconfigured" && state.reason.includes("AI_GATEWAY_KEY"),
      "reason names the missing env var",
    );
    check(isAiConfigured(valid) === false, "misconfigured is not configured");
  });
});

withEnv("AI_GATEWAY_URL", undefined, () => {
  withEnv("AI_GATEWAY_KEY", "sk-test", () => {
    check(
      aiConfigState(valid).kind === "misconfigured",
      "named-but-unset base URL var is misconfigured",
    );
  });
});

// --- a non-URL base URL is misconfigured, not a runtime surprise ---------------

withEnv("AI_GATEWAY_URL", "not-a-url", () => {
  withEnv("AI_GATEWAY_KEY", "sk-test", () => {
    check(
      aiConfigState(valid).kind === "misconfigured",
      "unparseable base URL is misconfigured",
    );
  });
});

// --- ready --------------------------------------------------------------------

withGateway(() => {
  const state = aiConfigState(valid);
  check(state.kind === "ready", "fully set config is ready");
  check(
    state.kind === "ready" && state.baseUrl === "http://127.0.0.1:4000/v1",
    "ready state carries the resolved base URL",
  );
  check(isAiConfigured(valid) === true, "ready is configured");
});

console.log(`config.test.ts: ${passed} assertions passed`);
