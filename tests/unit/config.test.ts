import { describe, it, expect } from "vitest";
import { LLM_PROVIDERS, LLM_MODELS } from "../../packages/shared/src/types/config.js";

describe("Config - LLM Providers", () => {
  it("has all expected providers", () => {
    expect(LLM_PROVIDERS).toContain("claude");
    expect(LLM_PROVIDERS).toContain("kimi");
    expect(LLM_PROVIDERS).toContain("openrouter");
  });

  it("each provider has at least one model", () => {
    for (const provider of LLM_PROVIDERS) {
      expect(LLM_MODELS[provider].length).toBeGreaterThan(0);
    }
  });
});
