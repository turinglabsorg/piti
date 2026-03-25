import { describe, it, expect } from "vitest";
import { computeNextRun } from "../../packages/gateway/src/orchestrator/reminderService.js";

describe("Reminder computeNextRun", () => {
  it("computes next run for daily at 8am UTC", () => {
    const next = computeNextRun("0 8 * * *", "UTC");
    expect(next).toBeInstanceOf(Date);
    expect(next.getUTCHours()).toBe(8);
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("computes next run for weekdays at 6:30 UTC", () => {
    const next = computeNextRun("30 6 * * 1-5", "UTC");
    expect(next).toBeInstanceOf(Date);
    expect(next.getUTCMinutes()).toBe(30);
    expect(next.getUTCHours()).toBe(6);
    // Day should be Mon-Fri (1-5)
    const day = next.getUTCDay();
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(5);
  });

  it("computes next run for weekly Monday at 19:00 UTC", () => {
    const next = computeNextRun("0 19 * * 1", "UTC");
    expect(next).toBeInstanceOf(Date);
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.getUTCHours()).toBe(19);
  });

  it("returns a future date", () => {
    const next = computeNextRun("* * * * *", "UTC");
    expect(next.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("respects timezone", () => {
    const utcNext = computeNextRun("0 8 * * *", "UTC");
    const romeNext = computeNextRun("0 8 * * *", "Europe/Rome");

    // Rome is UTC+1 or UTC+2 depending on DST, so the UTC time should differ
    // Rome 8:00 = UTC 7:00 or 6:00
    expect(romeNext.getUTCHours()).toBeLessThan(utcNext.getUTCHours());
  });

  it("throws on invalid cron expression", () => {
    expect(() => computeNextRun("invalid", "UTC")).toThrow();
  });
});
