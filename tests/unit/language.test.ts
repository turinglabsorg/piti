import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../packages/agent/src/agent/systemPrompt.js";

describe("Language in System Prompt", () => {
  it("defaults to english", () => {
    const prompt = buildSystemPrompt({}, []);
    expect(prompt).toContain("respond in **english**");
  });

  it("uses the specified language", () => {
    const prompt = buildSystemPrompt({}, [], "italian");
    expect(prompt).toContain("respond in **italian**");
    expect(prompt).toContain("reply in italian");
  });

  it("handles french", () => {
    const prompt = buildSystemPrompt({}, [], "french");
    expect(prompt).toContain("respond in **french**");
  });

  it("language instruction and topic boundary are both present", () => {
    const prompt = buildSystemPrompt({}, [], "spanish");
    expect(prompt).toContain("LANGUAGE");
    expect(prompt).toContain("STRICT TOPIC BOUNDARY");
  });
});
