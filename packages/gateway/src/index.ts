import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });
import Redis from "ioredis";
import { gatewayEnvSchema } from "@piti/shared";
import { createLogger } from "@piti/shared";
import { getDb, closeDb } from "./db/client.js";
import { ContainerManager } from "./orchestrator/containerManager.js";
import { Dispatcher } from "./orchestrator/dispatcher.js";
import { createBot } from "./bot/bot.js";

const logger = createLogger("gateway");

async function main() {
  // Validate env
  const env = gatewayEnvSchema.parse(process.env);

  // Connect to DB
  const db = getDb(env.DATABASE_URL);
  logger.info("Database connected");

  // Connect to Redis
  const redis = new Redis(env.REDIS_URL);
  redis.on("error", (err) => logger.error("Redis error", { error: err }));
  logger.info("Redis connected");

  // Build env vars to pass to agent containers
  // Agent containers run inside Docker and need internal URLs
  const agentEnvVars: Record<string, string> = {
    DATABASE_URL: env.AGENT_DATABASE_URL || env.DATABASE_URL,
  };
  if (env.ANTHROPIC_API_KEY) agentEnvVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.KIMI_API_KEY) agentEnvVars.KIMI_API_KEY = env.KIMI_API_KEY;
  if (env.OPENROUTER_API_KEY) agentEnvVars.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
  if (env.OPENAI_API_KEY) agentEnvVars.OPENAI_API_KEY = env.OPENAI_API_KEY;

  // Start container manager
  const containerManager = new ContainerManager(redis, {
    imageName: env.AGENT_IMAGE,
    portStart: env.AGENT_PORT_RANGE_START,
    portEnd: env.AGENT_PORT_RANGE_END,
    idleTimeoutMs: env.CONTAINER_IDLE_TIMEOUT_MS,
  });
  await containerManager.start();

  // Create dispatcher
  const dispatcher = new Dispatcher(db, containerManager, agentEnvVars, {
    llmProvider: env.DEFAULT_LLM_PROVIDER,
    llmModel: env.DEFAULT_LLM_MODEL,
    routerModel: env.DEFAULT_ROUTER_MODEL,
    smartModel: env.DEFAULT_SMART_MODEL,
    language: env.DEFAULT_LANGUAGE,
  });

  // Create and start bot
  const bot = createBot(env.TELEGRAM_BOT_TOKEN, db, dispatcher, {
    allowedUsers: env.TELEGRAM_ALLOWED_USERS,
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

  // Launch bot with retry on 409 conflict (previous instance still holding the poll)
  const MAX_RETRIES = 12;
  const RETRY_DELAY_MS = 10_000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await bot.launch();
      logger.info("PITI Gateway started");
      break;
    } catch (err: any) {
      const isConflict = err?.response?.error_code === 409;
      if (isConflict && attempt < MAX_RETRIES) {
        logger.warn(`Telegram conflict (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
}

main().catch((err) => {
  logger.error("Fatal error", { error: err });
  process.exit(1);
});
