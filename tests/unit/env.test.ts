import { describe, it, expect } from "vitest";
import { gatewayEnvSchema, agentEnvSchema } from "../../packages/shared/src/utils/env.js";

describe("Environment Validation", () => {
  describe("Gateway env", () => {
    it("validates a complete env", () => {
      const result = gatewayEnvSchema.safeParse({
        TELEGRAM_BOT_TOKEN: "123:ABC",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        REDIS_URL: "redis://localhost:6379",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.AGENT_IMAGE).toBe("piti-agent");
        expect(result.data.CONTAINER_IDLE_TIMEOUT_MS).toBe(3600000);
        expect(result.data.DEFAULT_LLM_PROVIDER).toBe("claude");
        expect(result.data.TELEGRAM_ALLOWED_USERS).toBe("");
      }
    });

    it("rejects missing TELEGRAM_BOT_TOKEN", () => {
      const result = gatewayEnvSchema.safeParse({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        REDIS_URL: "redis://localhost:6379",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid DATABASE_URL", () => {
      const result = gatewayEnvSchema.safeParse({
        TELEGRAM_BOT_TOKEN: "123:ABC",
        DATABASE_URL: "not-a-url",
        REDIS_URL: "redis://localhost:6379",
      });
      expect(result.success).toBe(false);
    });

    it("parses TELEGRAM_ALLOWED_USERS as string", () => {
      const result = gatewayEnvSchema.safeParse({
        TELEGRAM_BOT_TOKEN: "123:ABC",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        REDIS_URL: "redis://localhost:6379",
        TELEGRAM_ALLOWED_USERS: "12345,67890",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.TELEGRAM_ALLOWED_USERS).toBe("12345,67890");
      }
    });

    it("coerces port range numbers from strings", () => {
      const result = gatewayEnvSchema.safeParse({
        TELEGRAM_BOT_TOKEN: "123:ABC",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        REDIS_URL: "redis://localhost:6379",
        AGENT_PORT_RANGE_START: "5000",
        AGENT_PORT_RANGE_END: "5100",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.AGENT_PORT_RANGE_START).toBe(5000);
        expect(result.data.AGENT_PORT_RANGE_END).toBe(5100);
      }
    });
  });

  describe("Agent env", () => {
    it("validates a minimal env", () => {
      const result = agentEnvSchema.safeParse({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(3001);
      }
    });

    it("accepts all optional API keys", () => {
      const result = agentEnvSchema.safeParse({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        ANTHROPIC_API_KEY: "sk-ant-xxx",
        KIMI_API_KEY: "sk-kimi-xxx",
        OPENROUTER_API_KEY: "sk-or-xxx",
        OPENAI_API_KEY: "sk-xxx",
      });

      expect(result.success).toBe(true);
    });
  });
});
