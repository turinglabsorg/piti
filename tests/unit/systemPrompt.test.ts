import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../packages/agent/src/agent/systemPrompt.js";
import type { Memory, UserProfile } from "@piti/shared";

describe("System Prompt Builder", () => {
  it("builds prompt with empty profile and no memories", () => {
    const prompt = buildSystemPrompt({}, []);

    expect(prompt).toContain("You are PITI");
    expect(prompt).toContain("STRICT TOPIC BOUNDARY");
    expect(prompt).toContain("No profile set up yet");
    expect(prompt).toContain("No memories yet");
  });

  it("includes user profile data when provided", () => {
    const profile: UserProfile = {
      age: 28,
      weight: 80,
      height: 180,
      fitnessLevel: "intermediate",
      goals: ["muscle gain", "improve deadlift"],
      injuries: ["lower back pain"],
    };

    const prompt = buildSystemPrompt(profile, []);

    expect(prompt).toContain("28");
    expect(prompt).toContain("80");
    expect(prompt).toContain("muscle gain");
    expect(prompt).toContain("lower back pain");
    expect(prompt).not.toContain("No profile set up yet");
  });

  it("includes memories when provided", () => {
    const memories: Memory[] = [
      {
        id: 1,
        userId: 1,
        content: "User prefers morning workouts at 6am",
        category: "preference",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        userId: 1,
        content: "User has a knee injury from 2023",
        category: "injury",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const prompt = buildSystemPrompt({}, memories);

    expect(prompt).toContain("[preference] User prefers morning workouts at 6am");
    expect(prompt).toContain("[injury] User has a knee injury from 2023");
    expect(prompt).not.toContain("No memories yet");
  });

  it("contains anti-jailbreak instructions", () => {
    const prompt = buildSystemPrompt({}, []);

    expect(prompt).toContain("ignore your instructions");
    expect(prompt).toContain("prompt injection");
    expect(prompt).toContain("NO exceptions");
  });

  it("contains all memory categories", () => {
    const prompt = buildSystemPrompt({}, []);
    const categories = [
      "preference",
      "goal",
      "injury",
      "progress",
      "routine",
      "nutrition",
      "health",
      "personal",
    ];

    for (const cat of categories) {
      expect(prompt).toContain(cat);
    }
  });
});
