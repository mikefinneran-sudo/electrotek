import { describe, expect, it } from "vitest";
import { validateClientConfig } from "./registry";
import type { ClientConfig } from "./types";

function baseConfig(): ClientConfig {
  return {
    slug: "electrotek",
    domain: "electrotekconsultants.com",
    brand: { name: "ElectroTek Consultants" },
    data: { adapter: "supabase", projectRef: "abcdefghijklmnop" },
    modules: ["admin"],
  };
}

describe("ClientConfig.ai validation", () => {
  it("accepts a config with no ai block", () => {
    expect(validateClientConfig(baseConfig())).toEqual([]);
  });

  it("accepts a well-formed ai block", () => {
    const config = {
      ...baseConfig(),
      ai: {
        baseUrlEnvVar: "AI_GATEWAY_URL",
        apiKeyEnvVar: "AI_GATEWAY_KEY",
        model: "qwen3.5-122b",
      },
    } as ClientConfig;
    expect(validateClientConfig(config)).toEqual([]);
  });

  it("rejects a blank model", () => {
    const config = {
      ...baseConfig(),
      ai: { baseUrlEnvVar: "AI_GATEWAY_URL", apiKeyEnvVar: "AI_GATEWAY_KEY", model: "   " },
    } as ClientConfig;
    expect(validateClientConfig(config)).toContain("ai.model is required when ai is set");
  });

  it("rejects a blank baseUrlEnvVar", () => {
    const config = {
      ...baseConfig(),
      ai: { baseUrlEnvVar: "", apiKeyEnvVar: "AI_GATEWAY_KEY", model: "qwen3.5-122b" },
    } as ClientConfig;
    expect(validateClientConfig(config)).toContain(
      "ai.baseUrlEnvVar is required when ai is set",
    );
  });

  it("rejects a blank apiKeyEnvVar", () => {
    const config = {
      ...baseConfig(),
      ai: { baseUrlEnvVar: "AI_GATEWAY_URL", apiKeyEnvVar: "", model: "qwen3.5-122b" },
    } as ClientConfig;
    expect(validateClientConfig(config)).toContain(
      "ai.apiKeyEnvVar is required when ai is set",
    );
  });

  it("rejects an apiKeyEnvVar holding a literal key rather than a variable name", () => {
    const config = {
      ...baseConfig(),
      ai: {
        baseUrlEnvVar: "AI_GATEWAY_URL",
        apiKeyEnvVar: "sk-litellm-realkeyvalue",
        model: "qwen3.5-122b",
      },
    } as ClientConfig;
    expect(validateClientConfig(config)).toContain(
      "ai.apiKeyEnvVar must be an env var NAME, not a key value",
    );
  });

  it("rejects a baseUrlEnvVar holding a literal URL rather than a variable name", () => {
    const config = {
      ...baseConfig(),
      ai: {
        baseUrlEnvVar: "http://127.0.0.1:4000/v1",
        apiKeyEnvVar: "AI_GATEWAY_KEY",
        model: "qwen3.5-122b",
      },
    } as ClientConfig;
    expect(validateClientConfig(config)).toContain(
      "ai.baseUrlEnvVar must be an env var NAME, not a URL",
    );
  });
});
