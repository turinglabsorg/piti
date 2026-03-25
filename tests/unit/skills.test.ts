import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../packages/agent/src/agent/systemPrompt.js";
import type { Skill } from "@piti/shared";

describe("Skills in System Prompt", () => {
  it("includes skills as User Rules section when provided", () => {
    const skills: Skill[] = [
      { id: 1, content: "Always suggest vegetarian alternatives", enabled: true },
      { id: 2, content: "Speak more casually", enabled: true },
    ];

    const prompt = buildSystemPrompt({}, [], "english", skills);

    expect(prompt).toContain("## User Rules");
    expect(prompt).toContain("1. Always suggest vegetarian alternatives");
    expect(prompt).toContain("2. Speak more casually");
  });

  it("does not include User Rules section when no skills provided", () => {
    const prompt = buildSystemPrompt({}, [], "english", []);

    expect(prompt).not.toContain("## User Rules");
  });

  it("does not include User Rules section when skills is undefined", () => {
    const prompt = buildSystemPrompt({}, [], "english");

    expect(prompt).not.toContain("## User Rules");
  });

  it("numbers skills sequentially", () => {
    const skills: Skill[] = [
      { id: 10, content: "First rule", enabled: true },
      { id: 20, content: "Second rule", enabled: true },
      { id: 30, content: "Third rule", enabled: true },
    ];

    const prompt = buildSystemPrompt({}, [], "english", skills);

    expect(prompt).toContain("1. First rule");
    expect(prompt).toContain("2. Second rule");
    expect(prompt).toContain("3. Third rule");
  });

  it("places User Rules between profile and memories", () => {
    const skills: Skill[] = [
      { id: 1, content: "Test rule", enabled: true },
    ];

    const prompt = buildSystemPrompt({}, [], "english", skills);

    const profileIdx = prompt.indexOf("User Profile");
    const rulesIdx = prompt.indexOf("User Rules");
    const memoriesIdx = prompt.indexOf("Memories") > -1 ? prompt.indexOf("Memories") : prompt.indexOf("What I Remember");

    expect(profileIdx).toBeLessThan(rulesIdx);
    expect(rulesIdx).toBeLessThan(memoriesIdx);
  });
});
