import { describe, it, expect } from "vitest";
import { agentEnvSchema } from "../../packages/shared/src/utils/env.js";
import type { GatewayConfig } from "../../packages/shared/src/utils/env.js";

describe("Environment & Config Validation", () => {
  describe("GatewayConfig type", () => {
    it("accepts a valid config object", () => {
      const config: GatewayConfig = {
        telegram: {
          token: "123:ABC",
          allowed_users: [],
        },
        database: {
          url: "postgresql://user:pass@localhost:5432/db",
          agent_url: "postgresql://user:pass@host.docker.internal:5432/db",
        },
        redis: {
          url: "redis://localhost:6379",
        },
        docker: {
          agent_image: "piti-agent",
          port_range: [4000, 4100],
          idle_timeout_ms: 3600000,
        },
        llm: {
          default_provider: "openrouter",
          default_model: "google/gemini-2.5-flash",
          router_model: "google/gemini-2.5-flash",
          smart_model: "google/gemini-2.5-pro",
          default_language: "italian",
          providers: {
            openrouter: { api_key: "sk-or-xxx" },
            anthropic: { api_key: "" },
            kimi: { api_key: "" },
          },
        },
        mcp: {
          search: {
            enabled: true,
            image: "piti-mcp-search",
            port: 5100,
          },
        },
      };

      expect(config.telegram.token).toBe("123:ABC");
      expect(config.docker.port_range[0]).toBe(4000);
      expect(config.docker.port_range[1]).toBe(4100);
      expect(config.llm.default_provider).toBe("openrouter");
      expect(config.mcp.search.enabled).toBe(true);
    });

    it("supports allowed_users as number array", () => {
      const config: GatewayConfig = {
        telegram: {
          token: "123:ABC",
          allowed_users: [12345, 67890],
        },
        database: {
          url: "postgresql://user:pass@localhost:5432/db",
          agent_url: "postgresql://user:pass@host.docker.internal:5432/db",
        },
        redis: { url: "redis://localhost:6379" },
        docker: {
          agent_image: "piti-agent",
          port_range: [4000, 4100],
          idle_timeout_ms: 3600000,
        },
        llm: {
          default_provider: "claude",
          default_model: "claude-sonnet-4-20250514",
          router_model: "google/gemini-2.5-flash",
          smart_model: "google/gemini-2.5-pro",
          default_language: "english",
          providers: {
            openrouter: { api_key: "" },
            anthropic: { api_key: "sk-ant-xxx" },
            kimi: { api_key: "" },
          },
        },
        mcp: {},
      };

      expect(config.telegram.allowed_users).toEqual([12345, 67890]);
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
        expect(result.data.MCP_SERVERS).toBeUndefined();
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

    it("accepts MCP_SERVERS as optional JSON string", () => {
      const mcpServers = JSON.stringify([
        { name: "search", url: "http://host.docker.internal:5100/sse" },
      ]);

      const result = agentEnvSchema.safeParse({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        MCP_SERVERS: mcpServers,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.MCP_SERVERS).toBe(mcpServers);
      }
    });
  });
});
