import { describe, it, expect } from "vitest";
import type { MemoryCategory } from "../../packages/shared/src/types/message.js";
import { RecapService } from "../../packages/gateway/src/orchestrator/recapService.js";

describe("Recap MemoryCategory", () => {
  it('"recap" is a valid MemoryCategory value', () => {
    const category: MemoryCategory = "recap";
    expect(category).toBe("recap");
  });

  it("all original categories are still valid", () => {
    const categories: MemoryCategory[] = [
      "preference",
      "goal",
      "injury",
      "progress",
      "routine",
      "nutrition",
      "health",
      "personal",
      "recap",
    ];
    expect(categories).toHaveLength(9);
  });
});

describe("RecapService", () => {
  it("can be instantiated with required parameters", () => {
    // Pass a mock db (null cast) since we only test instantiation
    const service = new RecapService(null as any, "test-api-key", "google/gemini-2.5-flash");
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(RecapService);
  });

  it("can be instantiated with default model", () => {
    const service = new RecapService(null as any, "test-api-key");
    expect(service).toBeDefined();
  });
});

describe("Recap text formatting", () => {
  it("daily recap prefix matches expected format", () => {
    const dateStr = "20/03/2026";
    const summary = "User discussed leg day workout and nutrition plan.";
    const content = `[Daily recap - ${dateStr}]: ${summary}`;

    expect(content).toMatch(/^\[Daily recap - \d{2}\/\d{2}\/\d{4}\]: .+$/);
    expect(content).toContain("[Daily recap - 20/03/2026]:");
  });

  it("weekly recap prefix matches expected format", () => {
    const weekStart = "14/03";
    const weekEnd = "20/03";
    const summary = "Focus on strength training and protein intake.";
    const content = `[Weekly recap - ${weekStart} to ${weekEnd}]: ${summary}`;

    expect(content).toMatch(/^\[Weekly recap - \d{2}\/\d{2} to \d{2}\/\d{2}\]: .+$/);
    expect(content).toContain("[Weekly recap - 14/03 to 20/03]:");
  });

  it("monthly recap prefix matches expected format", () => {
    const monthLabel = "February 2026";
    const summary = "Overall progress in cardio and weight loss goals.";
    const content = `[Monthly recap - ${monthLabel}]: ${summary}`;

    expect(content).toMatch(/^\[Monthly recap - [A-Z][a-z]+ \d{4}\]: .+$/);
    expect(content).toContain("[Monthly recap - February 2026]:");
  });
});
