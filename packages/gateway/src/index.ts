import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import Redis from "ioredis";
import type { GatewayConfig } from "@piti/shared";
import { createLogger } from "@piti/shared";
import { getDb, closeDb } from "./db/client.js";
import { ContainerManager } from "./orchestrator/containerManager.js";
import { Dispatcher } from "./orchestrator/dispatcher.js";
import { createBot } from "./bot/bot.js";
import { McpManager } from "./orchestrator/mcpManager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createLogger("gateway");

function loadConfig(): GatewayConfig {
  const configPath = resolve(__dirname, "../../../config.yaml");
  const raw = readFileSync(configPath, "utf-8");
  return parseYaml(raw) as GatewayConfig;
}

async function main() {
  // Load YAML config
  const config = loadConfig();
  logger.info("Config loaded from config.yaml");

  // Connect to DB
  const db = getDb(config.database.url);
  logger.info("Database connected");

  // Connect to Redis
  const redis = new Redis(config.redis.url);
  redis.on("error", (err) => logger.error("Redis error", { error: err }));
  logger.info("Redis connected");

  // Ensure MCP containers are running
  const mcpManager = new McpManager();
  const mcpServers = await mcpManager.ensureRunning(config.mcp);

  // Build env vars to pass to agent containers
  const agentEnvVars: Record<string, string> = {
    DATABASE_URL: config.database.agent_url || config.database.url,
  };
  if (config.llm.providers.anthropic?.api_key) {
    agentEnvVars.ANTHROPIC_API_KEY = config.llm.providers.anthropic.api_key;
  }
  if (config.llm.providers.kimi?.api_key) {
    agentEnvVars.KIMI_API_KEY = config.llm.providers.kimi.api_key;
  }
  if (config.llm.providers.openrouter?.api_key) {
    agentEnvVars.OPENROUTER_API_KEY = config.llm.providers.openrouter.api_key;
  }

  // Pass MCP server URLs to agent containers
  if (mcpServers.length > 0) {
    agentEnvVars.MCP_SERVERS = JSON.stringify(mcpServers);
  }

  // Start container manager
  const containerManager = new ContainerManager(redis, {
    imageName: config.docker.agent_image,
    portStart: config.docker.port_range[0],
    portEnd: config.docker.port_range[1],
    idleTimeoutMs: config.docker.idle_timeout_ms,
  });
  await containerManager.start();

  // Create dispatcher
  const dispatcher = new Dispatcher(db, containerManager, agentEnvVars, {
    llmProvider: config.llm.default_provider,
    llmModel: config.llm.default_model,
    routerModel: config.llm.router_model,
    smartModel: config.llm.smart_model,
    language: config.llm.default_language,
  });

  // Create and start bot
  const allowedUsersStr = (config.telegram.allowed_users || []).join(",");
  const bot = createBot(config.telegram.token, db, dispatcher, {
    allowedUsers: allowedUsersStr,
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    bot.stop("SIGTERM");
    await containerManager.stop();
    redis.disconnect();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Launch bot — drop pending updates to avoid 409 conflict with previous instance
  bot.launch({ dropPendingUpdates: true });
  logger.info("PITI Gateway started");
}

main().catch((err) => {
  logger.error("Fatal error", { error: err });
  process.exit(1);
});
