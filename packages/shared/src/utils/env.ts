import { z } from "zod";

export const gatewayEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  KIMI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AGENT_IMAGE: z.string().default("piti-agent"),
  AGENT_PORT_RANGE_START: z.coerce.number().default(4000),
  AGENT_PORT_RANGE_END: z.coerce.number().default(4100),
  CONTAINER_IDLE_TIMEOUT_MS: z.coerce.number().default(3600000),
  DEFAULT_LLM_PROVIDER: z.string().default("claude"),
  DEFAULT_LLM_MODEL: z.string().default("claude-sonnet-4-20250514"),
  DEFAULT_ROUTER_MODEL: z.string().default("google/gemini-2.5-flash"),
  DEFAULT_SMART_MODEL: z.string().default("google/gemini-2.5-pro"),
  DEFAULT_LANGUAGE: z.string().default("english"),
  AGENT_DATABASE_URL: z.string().optional(),
  // Comma-separated Telegram user IDs. Empty = anyone can use the bot.
  TELEGRAM_ALLOWED_USERS: z.string().default(""),
});

export const agentEnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().optional(),
  KIMI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

export type GatewayEnv = z.infer<typeof gatewayEnvSchema>;
export type AgentEnv = z.infer<typeof agentEnvSchema>;
