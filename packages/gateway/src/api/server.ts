import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Dispatcher } from "../orchestrator/dispatcher.js";
import type { Database } from "../db/client.js";
import { eq, sql } from "drizzle-orm";
import { users, memories, tokenUsage, mcpCalls } from "../db/schema.js";
import { createLogger } from "@piti/shared";

const logger = createLogger("api");

interface ApiConfig {
  port: number;
  apiKey?: string;
  userMap: Record<string, number>;
}

interface ChatBody {
  message: string;
  user?: string;
}

const MAX_REQUESTS_PER_MINUTE = 30;
const rateLimitStore = new Map<string, number[]>();

/**
 * Local HTTP API — alternative frontend to Telegram.
 *
 * Endpoints:
 *   POST /chat        { message, user? } → { reply, ... }
 *   GET  /status/:user → user status, tokens, mcp calls
 *   GET  /health       → health check
 */
export async function startApiServer(
  config: ApiConfig,
  db: Database,
  dispatcher: Dispatcher
) {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: config.apiKey ? false : true,
  });

  // API key authentication
  if (config.apiKey) {
    app.addHook("onRequest", async (request, reply) => {
      // Skip auth for health check
      if (request.url === "/health") return;

      const authHeader = request.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${config.apiKey}`) {
        reply.status(401).send({ error: "Unauthorized" });
        return;
      }
    });
    logger.info("API authentication enabled");
  } else {
    logger.warn("API running without authentication — set api.api_key in config.yaml");
  }

  // Simple rate limiting
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;

    const ip = request.ip;
    const now = Date.now();
    const windowMs = 60_000;

    let timestamps = rateLimitStore.get(ip) || [];
    timestamps = timestamps.filter((t) => now - t < windowMs);
    timestamps.push(now);
    rateLimitStore.set(ip, timestamps);

    if (timestamps.length > MAX_REQUESTS_PER_MINUTE) {
      reply.status(429).send({ error: "Too many requests" });
      return;
    }
  });

  function resolveUser(userKey?: string): { telegramId: number; username: string } {
    const key = userKey || "local";
    const telegramId = config.userMap[key];
    if (!telegramId) {
      throw new Error(`Unknown API user '${key}'. Configure it in config.yaml api.user_map`);
    }
    return { telegramId, username: key };
  }

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.post<{ Body: ChatBody }>("/chat", async (request, reply) => {
    const { message, user } = request.body;
    if (!message) {
      return reply.status(400).send({ error: "message is required" });
    }

    try {
      const { telegramId, username } = resolveUser(user);

      const result = await dispatcher.dispatch(
        telegramId,
        message,
        username
      );

      return {
        reply: result.reply,
        isNewUser: result.isNewUser,
        detectedLanguage: result.detectedLanguage,
      };
    } catch (err: any) {
      logger.error("API chat error", { error: err });
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  app.get<{ Params: { user?: string } }>("/status/:user", async (request, reply) => {
    try {
      const { telegramId } = resolveUser(request.params.user);

      const user = await db
        .select()
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);

      if (user.length === 0) {
        return reply.status(404).send({ error: "User not found" });
      }

      const usageStats = await db
        .select({
          model: tokenUsage.model,
          totalIn: sql<number>`SUM(${tokenUsage.inputTokens})`,
          totalOut: sql<number>`SUM(${tokenUsage.outputTokens})`,
          calls: sql<number>`COUNT(*)`,
        })
        .from(tokenUsage)
        .where(eq(tokenUsage.userId, user[0].id))
        .groupBy(tokenUsage.model);

      const mcpStats = await db
        .select({
          server: mcpCalls.server,
          tool: mcpCalls.tool,
          calls: sql<number>`COUNT(*)`,
          avgMs: sql<number>`ROUND(AVG(${mcpCalls.durationMs}))`,
        })
        .from(mcpCalls)
        .where(eq(mcpCalls.userId, user[0].id))
        .groupBy(mcpCalls.server, mcpCalls.tool);

      const userMemories = await db
        .select()
        .from(memories)
        .where(eq(memories.userId, user[0].id))
        .limit(20);

      return {
        user: {
          id: user[0].id,
          username: user[0].username,
          language: user[0].language,
          provider: user[0].llmProvider,
          model: user[0].llmModel,
        },
        tokenUsage: usageStats,
        mcpUsage: mcpStats,
        memories: userMemories.map((m) => ({
          category: m.category,
          content: m.content,
        })),
      };
    } catch (err: any) {
      logger.error("API status error", { error: err });
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  app.get("/status", async () => {
    const allUsers = await db.select().from(users);
    return {
      users: allUsers.map((u) => ({
        id: u.id,
        telegramId: u.telegramId,
        username: u.username,
        language: u.language,
        provider: u.llmProvider,
      })),
    };
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info(`API server listening on port ${config.port}`);
}
