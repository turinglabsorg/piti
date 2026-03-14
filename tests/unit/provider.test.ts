import { describe, it, expect } from "vitest";
import { getModel } from "../../packages/agent/src/llm/provider.js";

describe("LLM Provider", () => {
  it("creates a Claude model", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const model = getModel("claude", "claude-sonnet-4-20250514");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });

  it("creates a Kimi model", () => {
    process.env.KIMI_API_KEY = "test-key";
    const model = getModel("kimi", "kimi-2.5");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("kimi-2.5");
  });

  it("creates an OpenRouter model", () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const model = getModel("openrouter", "anthropic/claude-sonnet-4-20250514");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("throws for unknown provider", () => {
    expect(() => getModel("gpt-local", "whatever")).toThrow(
      "Unknown LLM provider: gpt-local"
    );
  });
});
