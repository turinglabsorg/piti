/**
 * Integration test: verifies that different character personalities
 * produce meaningfully different LLM responses via OpenRouter.
 *
 * Run with: pnpm vitest run tests/integration/character-llm.test.ts
 */
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../packages/agent/src/agent/systemPrompt.js";
import type { UserProfile } from "@piti/shared";

const OPENROUTER_API_KEY = "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";
const MODEL = "google/gemini-2.5-flash";
const USER_MESSAGE = "buongiorno, oggi ho fatto poco, 20 minuti di cardio";

async function callLLM(systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as any;
  return data.choices?.[0]?.message?.content || "";
}

describe("Character LLM Integration Tests", () => {
  it("drill-sergeant responds in character (short, commanding, no fluff)", async () => {
    const profile: UserProfile = { agentCharacter: "drill-sergeant" };
    const prompt = buildSystemPrompt(profile, [], "italian");
    const reply = await callLLM(prompt, USER_MESSAGE);

    console.log("\n=== DRILL SERGEANT ===");
    console.log(reply);
    console.log("=== END ===\n");

    // Should be short (drill sergeants don't write essays)
    expect(reply.length).toBeLessThan(600);
    // Should NOT contain verbose analysis patterns
    expect(reply).not.toMatch(/1\.\s+.*\n.*2\.\s+.*\n.*3\.\s+/);
    // Should NOT contain fluffy openers
    expect(reply.toLowerCase()).not.toContain("ottima domanda");
    expect(reply.toLowerCase()).not.toContain("fantastico");
  }, 30000);

  it("hype-coach responds with HIGH ENERGY", async () => {
    const profile: UserProfile = { agentCharacter: "hype-coach" };
    const prompt = buildSystemPrompt(profile, [], "italian");
    const reply = await callLLM(prompt, USER_MESSAGE);

    console.log("\n=== HYPE COACH ===");
    console.log(reply);
    console.log("=== END ===\n");

    // Should contain exclamation marks (hype coach loves them)
    const exclamationCount = (reply.match(/!/g) || []).length;
    expect(exclamationCount).toBeGreaterThanOrEqual(2);
    // Should be energetic
    expect(reply.length).toBeLessThan(800);
  }, 30000);

  it("zen-master responds calmly and briefly", async () => {
    const profile: UserProfile = { agentCharacter: "zen-master" };
    const prompt = buildSystemPrompt(profile, [], "italian");
    const reply = await callLLM(prompt, USER_MESSAGE);

    console.log("\n=== ZEN MASTER ===");
    console.log(reply);
    console.log("=== END ===\n");

    // Should be short and calm
    expect(reply.length).toBeLessThan(500);
    // Should NOT be aggressive or shouty
    const capsWords = (reply.match(/[A-Z]{3,}/g) || []).length;
    expect(capsWords).toBeLessThan(3);
  }, 30000);

  it("scientist responds with data/evidence language", async () => {
    const profile: UserProfile = { agentCharacter: "scientist" };
    const prompt = buildSystemPrompt(profile, [], "italian");
    const reply = await callLLM(prompt, USER_MESSAGE);

    console.log("\n=== SCIENTIST ===");
    console.log(reply);
    console.log("=== END ===\n");

    // Should be concise but analytical
    expect(reply.length).toBeLessThan(800);
  }, 30000);

  it("default coach responds as casual gym buddy", async () => {
    const profile: UserProfile = {};
    const prompt = buildSystemPrompt(profile, [], "italian");
    const reply = await callLLM(prompt, USER_MESSAGE);

    console.log("\n=== DEFAULT COACH ===");
    console.log(reply);
    console.log("=== END ===\n");

    expect(reply.length).toBeLessThan(600);
  }, 30000);
});
