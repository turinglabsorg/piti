import { z } from "zod";

// ── Gateway Config (loaded from config.yaml) ──

export interface McpServerConfig {
  enabled: boolean;
  image: string;
  port: number;
}

export interface GatewayConfig {
  telegram: {
    token: string;
    allowed_users: number[];
  };
  database: {
    url: string;
    agent_url: string;
  };
  redis: {
    url: string;
  };
  docker: {
    agent_image: string;
    port_range: [number, number];
    idle_timeout_ms: number;
  };
  llm: {
    default_provider: string;
    default_model: string;
    router_model: string;
    smart_model: string;
    default_language: string;
    providers: {
      openrouter: { api_key: string };
      anthropic: { api_key: string };
      kimi: { api_key: string };
      [key: string]: { api_key: string };
    };
  };
  mcp: {
    [name: string]: McpServerConfig;
  };
}

// Keep the old export name so existing imports don't break at type level.
// Tests that used gatewayEnvSchema.safeParse() will be updated.
export type GatewayEnv = GatewayConfig;

// ── Agent Env (still env-var based, passed by gateway to containers) ──

export const agentEnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().optional(),
  KIMI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MCP_SERVERS: z.string().optional(),
});

export type AgentEnv = z.infer<typeof agentEnvSchema>;
