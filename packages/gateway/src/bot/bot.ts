import { Telegraf, type Context } from "telegraf";
import type { Database } from "../db/client.js";
import type { Dispatcher } from "../orchestrator/dispatcher.js";
import { registerCommandHandlers } from "./handlers/command.js";
import { registerMessageHandler } from "./handlers/message.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createLogger } from "@piti/shared";

const logger = createLogger("bot");

export interface BotOptions {
  allowedUsers: string;
}

export function createBot(token: string, db: Database, dispatcher: Dispatcher, opts: BotOptions): Telegraf<Context> {
  const bot = new Telegraf(token);

  // Auth middleware (must be first)
  bot.use(createAuthMiddleware(opts.allowedUsers));

  // Rate limiting middleware
  const lastMessage = new Map<number, number>();
  const RATE_LIMIT_MS = 2000;

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const now = Date.now();
    const last = lastMessage.get(userId) || 0;

    if (now - last < RATE_LIMIT_MS) {
      return; // Drop message silently
    }

    lastMessage.set(userId, now);
    return next();
  });

  // Register handlers
  registerCommandHandlers(bot, db);
  registerMessageHandler(bot, dispatcher);

  // Error handling
  bot.catch((err: any) => {
    logger.error("Bot error", { error: err });
  });

  return bot;
}
