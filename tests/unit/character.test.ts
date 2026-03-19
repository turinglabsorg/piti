import { describe, it, expect } from "vitest";
import {
  AGENT_CHARACTERS,
  AGENT_CHARACTER_LABELS,
  AGENT_CHARACTER_SET,
  type AgentCharacter,
} from "../../packages/shared/src/types/user.js";

describe("Agent Character Types", () => {
  it("has 6 character options", () => {
    expect(AGENT_CHARACTERS).toHaveLength(6);
  });

  it("includes default character", () => {
    expect(AGENT_CHARACTERS).toContain("default");
  });

  it("all characters have labels", () => {
    for (const char of AGENT_CHARACTERS) {
      expect(AGENT_CHARACTER_LABELS[char]).toBeDefined();
      expect(AGENT_CHARACTER_LABELS[char].length).toBeGreaterThan(0);
    }
  });

  it("character set validates known characters", () => {
    for (const char of AGENT_CHARACTERS) {
      expect(AGENT_CHARACTER_SET.has(char)).toBe(true);
    }
  });

  it("character set rejects unknown characters", () => {
    expect(AGENT_CHARACTER_SET.has("unknown")).toBe(false);
    expect(AGENT_CHARACTER_SET.has("")).toBe(false);
    expect(AGENT_CHARACTER_SET.has("coach")).toBe(false);
  });

  it("character labels are human-readable", () => {
    expect(AGENT_CHARACTER_LABELS["default"]).toBe("Balanced Coach");
    expect(AGENT_CHARACTER_LABELS["drill-sergeant"]).toBe("Drill Sergeant");
    expect(AGENT_CHARACTER_LABELS["best-friend"]).toBe("Best Friend");
    expect(AGENT_CHARACTER_LABELS["scientist"]).toBe("The Scientist");
    expect(AGENT_CHARACTER_LABELS["zen-master"]).toBe("Zen Master");
    expect(AGENT_CHARACTER_LABELS["hype-coach"]).toBe("Hype Coach");
  });
});
