import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
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
import { initEmbeddings } from "./embeddings.js";
import { RecapService } from "./orchestrator/recapService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createLogger("gateway");

const CONFIG_PATH = resolve(__dirname, "../../../config.yaml");

function loadConfig(): GatewayConfig {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return parseYaml(raw) as GatewayConfig;
}

function startStatusPing(
  containerManager: ContainerManager,
  billingUrl: string,
  apiSecret: string
) {
  const ping = async () => {
    try {
      const agentCount = await containerManager.getRunningContainerCount();
      await fetch(`${billingUrl}/status/ping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-secret": apiSecret,
        },
        body: JSON.stringify({ agentCount }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.warn("Status ping failed", { error: err });
    }
  };

  // Send initial ping, then every 60s
  ping();
  setInterval(ping, 60_000);
  logger.info("Status ping started (every 60s)");
}

async function main() {
  // Load YAML config
  const config = loadConfig();
  logger.info("Config loaded from config.yaml");

  // Initialize embeddings for RAG memory
  if (config.llm.providers.openrouter?.api_key) {
    initEmbeddings(config.llm.providers.openrouter.api_key);
    logger.info("Embeddings initialized (OpenRouter)");
  }

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

  // Generate a shared secret for gateway ↔ agent authentication
  const agentSecret = randomUUID();

  // Start container manager
  const containerManager = new ContainerManager(redis, {
    imageName: config.docker.agent_image,
    portStart: config.docker.port_range[0],
    portEnd: config.docker.port_range[1],
    idleTimeoutMs: config.docker.idle_timeout_ms,
    agentSecret,
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
      apiSecret: config.billing.api_secret,
      costs: config.billing.costs,
    });
    dispatcher.setBilling(billing);
    logger.info("Billing enabled", { url: config.billing.url });
  }

  // Start status ping to billing service
  if (config.billing?.enabled && config.billing.url) {
    startStatusPing(containerManager, config.billing.url, config.billing.api_secret);
  }

  // Create and start bot
  const allowedUsersStr = (config.telegram.allowed_users || []).join(",");
  const bot = createBot(config.telegram.token, db, dispatcher, {
    allowedUsers: allowedUsersStr,
    mcpBridgeUrl: mcpBridgeUrl ? `http://localhost:${5100}` : undefined,
    billingUrl: config.billing?.enabled ? config.billing.url : undefined,
    billingApiSecret: config.billing?.enabled ? config.billing.api_secret : undefined,
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

  // Create recap service for automated conversation summaries
  const recapService = new RecapService(
    db,
    config.llm.providers.openrouter?.api_key || "",
    "google/gemini-2.5-flash"
  );

  // Daily date-change scheduler — runs at midnight local time
  scheduleDailyDateChange(dispatcher, recapService);

  // Start local HTTP API if enabled
  if (config.api?.enabled) {
    await startApiServer(
      {
        port: config.api.port,
        apiKey: config.api.api_key,
        userMap: config.api.user_map,
      },
      db,
      dispatcher
    );
  }

  logger.info("PITI Gateway started");
}

function scheduleDailyDateChange(dispatcher: Dispatcher, recapService: RecapService) {
  const runAtMidnight = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(async () => {
      try {
        const today = new Date();
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const dayName = dayNames[today.getDay()];
        const dateStr = today.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

        const content = `[SYSTEM] Today is ${dayName}, ${dateStr}. A new day has started. Consider the user's weekly routine, goals, and schedule when they message you today.`;
        const count = await dispatcher.broadcastSystemMessage(content);
        logger.info("Daily date change broadcast", { date: dateStr, usersNotified: count });

        // Run daily recaps (fire and forget)
        recapService.runDailyRecaps().then((n) => {
          logger.info("Daily recaps finished", { usersProcessed: n });
        }).catch((err) => {
          logger.error("Daily recaps failed", { error: err });
        });

        // Run weekly recaps on Mondays (5 min delay)
        if (today.getDay() === 1) {
          setTimeout(() => {
            recapService.runWeeklyRecaps().then((n) => {
              logger.info("Weekly recaps finished", { usersProcessed: n });
            }).catch((err) => {
              logger.error("Weekly recaps failed", { error: err });
            });
          }, 5 * 60 * 1000);
        }

        // Run monthly recaps on the 1st (10 min delay)
        if (today.getDate() === 1) {
          setTimeout(() => {
            recapService.runMonthlyRecaps().then((n) => {
              logger.info("Monthly recaps finished", { usersProcessed: n });
            }).catch((err) => {
              logger.error("Monthly recaps failed", { error: err });
            });
          }, 10 * 60 * 1000);
        }
      } catch (err) {
        logger.error("Daily date change failed", { error: err });
      }

      // Schedule next run
      runAtMidnight();
    }, msUntilMidnight);

    logger.info("Daily scheduler set", { nextRunIn: `${Math.round(msUntilMidnight / 60000)}min` });
  };

  runAtMidnight();
}

main().catch((err) => {
  logger.error("Fatal error", { error: err });
  process.exit(1);
});
