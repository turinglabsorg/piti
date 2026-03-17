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
import { startApiServer } from "./api/server.js";
import { BillingClient } from "./billing/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createLogger("gateway");

const CONFIG_PATH = resolve(__dirname, "../../../config.yaml");

function loadConfig(): GatewayConfig {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
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

  // Ensure MCP bridge container is running
  const mcpManager = new McpManager(CONFIG_PATH);
  const mcpBridgeUrl = await mcpManager.ensureBridgeRunning(config.mcp);

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

  // Pass MCP bridge URL to agent containers
  if (mcpBridgeUrl) {
    agentEnvVars.MCP_BRIDGE_URL = mcpBridgeUrl;
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

  // Set up billing if enabled
  if (config.billing?.enabled && config.billing.url) {
    const billing = new BillingClient({
      url: config.billing.url,
      costs: config.billing.costs,
    });
    dispatcher.setBilling(billing);
    logger.info("Billing enabled", { url: config.billing.url });
  }

  // Create and start bot
  const allowedUsersStr = (config.telegram.allowed_users || []).join(",");
  const bot = createBot(config.telegram.token, db, dispatcher, {
    allowedUsers: allowedUsersStr,
    mcpBridgeUrl: mcpBridgeUrl ? `http://localhost:${5100}` : undefined,
    billingUrl: config.billing?.enabled ? config.billing.url : undefined,
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

  // Start local HTTP API if enabled
  if (config.api?.enabled) {
    await startApiServer(
      {
        port: config.api.port,
        userMap: config.api.user_map,
      },
      db,
      dispatcher
    );
  }

  logger.info("PITI Gateway started");
}

main().catch((err) => {
  logger.error("Fatal error", { error: err });
  process.exit(1);
});
