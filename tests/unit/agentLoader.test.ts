import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { buildSystemPrompt } from "../../packages/agent/src/agent/systemPrompt.js";

const AGENT_FOLDER = resolve("agents/personal-trainer");
const PERSONALITIES_FOLDER = join(AGENT_FOLDER, "personalities");

const EXPECTED_PERSONALITIES = [
  "default",
  "drill-sergeant",
  "best-friend",
  "scientist",
  "zen-master",
  "hype-coach",
];

const EXPECTED_LANGUAGES = [
  "english",
  "italian",
  "spanish",
  "french",
  "german",
  "portuguese",
];

describe("Agent Folder Structure", () => {
  it("agents/personal-trainer/ folder exists", () => {
    expect(existsSync(AGENT_FOLDER)).toBe(true);
  });

  it("SOUL.md exists and is not empty", () => {
    const path = join(AGENT_FOLDER, "SOUL.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content.length).toBeGreaterThan(100);
  });

  it("SOUL.md contains {{name}} placeholder", () => {
    const content = readFileSync(join(AGENT_FOLDER, "SOUL.md"), "utf-8");
    expect(content).toContain("{{name}}");
  });

  it("SOUL.md contains topic boundary", () => {
    const content = readFileSync(join(AGENT_FOLDER, "SOUL.md"), "utf-8");
    expect(content).toContain("STRICT TOPIC BOUNDARY");
  });

  it("SOUL.md contains expertise section", () => {
    const content = readFileSync(join(AGENT_FOLDER, "SOUL.md"), "utf-8");
    expect(content).toContain("Expertise");
  });

  it("personalities/ folder exists", () => {
    expect(existsSync(PERSONALITIES_FOLDER)).toBe(true);
  });
});

describe("Personality Files", () => {
  for (const personality of EXPECTED_PERSONALITIES) {
    it(`${personality}.md exists and is not empty`, () => {
      const path = join(PERSONALITIES_FOLDER, `${personality}.md`);
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(content.length).toBeGreaterThan(50);
    });
  }

  it("default.md contains gym buddy reference", () => {
    const content = readFileSync(join(PERSONALITIES_FOLDER, "default.md"), "utf-8");
    expect(content.toLowerCase()).toContain("gym buddy");
  });

  it("drill-sergeant.md contains military/tough language", () => {
    const content = readFileSync(join(PERSONALITIES_FOLDER, "drill-sergeant.md"), "utf-8");
    expect(content.toLowerCase()).toMatch(/drill sergeant|no.nonsense|tough/);
  });

  it("hype-coach.md contains high energy language", () => {
    const content = readFileSync(join(PERSONALITIES_FOLDER, "hype-coach.md"), "utf-8");
    expect(content).toMatch(/MAXIMUM ENERGY|ENERGY/);
  });

  it("zen-master.md contains mindfulness language", () => {
    const content = readFileSync(join(PERSONALITIES_FOLDER, "zen-master.md"), "utf-8");
    expect(content.toLowerCase()).toMatch(/calm|mindful|zen/);
  });

  it("scientist.md contains data-driven language", () => {
    const content = readFileSync(join(PERSONALITIES_FOLDER, "scientist.md"), "utf-8");
    expect(content.toLowerCase()).toMatch(/data.driven|evidence|analytical/);
  });

  it("best-friend.md contains warm/supportive language", () => {
    const content = readFileSync(join(PERSONALITIES_FOLDER, "best-friend.md"), "utf-8");
    expect(content.toLowerCase()).toMatch(/warm|supportive|encouraging/);
  });
});

describe("Personality Labels (labels.json)", () => {
  const labelsPath = join(PERSONALITIES_FOLDER, "labels.json");

  it("labels.json exists", () => {
    expect(existsSync(labelsPath)).toBe(true);
  });

  const labels = JSON.parse(readFileSync(labelsPath, "utf-8"));

  for (const lang of EXPECTED_LANGUAGES) {
    it(`has labels for ${lang}`, () => {
      expect(labels[lang]).toBeDefined();
    });

    for (const personality of EXPECTED_PERSONALITIES) {
      it(`${lang} has label for ${personality}`, () => {
        expect(labels[lang][personality]).toBeDefined();
        expect(labels[lang][personality].length).toBeGreaterThan(0);
      });
    }
  }
});

describe("Personality Descriptions (descriptions.json)", () => {
  const descsPath = join(PERSONALITIES_FOLDER, "descriptions.json");

  it("descriptions.json exists", () => {
    expect(existsSync(descsPath)).toBe(true);
  });

  const descs = JSON.parse(readFileSync(descsPath, "utf-8"));

  for (const lang of EXPECTED_LANGUAGES) {
    it(`has descriptions for ${lang}`, () => {
      expect(descs[lang]).toBeDefined();
    });

    for (const personality of EXPECTED_PERSONALITIES) {
      it(`${lang} has description for ${personality}`, () => {
        expect(descs[lang][personality]).toBeDefined();
        expect(descs[lang][personality].length).toBeGreaterThan(20);
      });
    }
  }
});

describe("buildSystemPrompt loads from files correctly", () => {

  it("default prompt contains soul content from SOUL.md", () => {
    const prompt = buildSystemPrompt({}, []);
    expect(prompt).toContain("PITI");
    expect(prompt).toContain("STRICT TOPIC BOUNDARY");
    expect(prompt).toContain("Expertise");
  });

  it("custom name replaces {{name}} placeholder", () => {
    const prompt = buildSystemPrompt({ agentName: "CoachRex" }, []);
    expect(prompt).toContain("CoachRex");
    expect(prompt).not.toContain("{{name}}");
  });

  it("drill-sergeant personality loads from file", () => {
    const prompt = buildSystemPrompt({ agentCharacter: "drill-sergeant" }, []);
    expect(prompt.toLowerCase()).toMatch(/drill sergeant|no.nonsense|tough/);
  });

  it("zen-master personality loads from file", () => {
    const prompt = buildSystemPrompt({ agentCharacter: "zen-master" }, []);
    expect(prompt.toLowerCase()).toMatch(/calm|mindful|zen/);
  });

  it("hype-coach personality loads from file", () => {
    const prompt = buildSystemPrompt({ agentCharacter: "hype-coach" }, []);
    expect(prompt).toMatch(/MAXIMUM ENERGY|ENERGY/);
  });

  it("shared rules are still present (not in files)", () => {
    const prompt = buildSystemPrompt({}, [], "italian");
    expect(prompt).toContain("LANGUAGE");
    expect(prompt).toContain("respond in **italian**");
    expect(prompt).toContain("Response Length");
    expect(prompt).toContain("Safety Rules");
    expect(prompt).toContain("Memory Instructions");
  });
});
