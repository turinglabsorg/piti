import { Telegraf, type Context } from "telegraf";
import type { Database } from "../db/client.js";
import type { Dispatcher } from "../orchestrator/dispatcher.js";
import { registerCommandHandlers } from "./handlers/command.js";
import { registerSkillsHandlers } from "./handlers/skills.js";
import { registerRemindersHandlers } from "./handlers/reminders.js";
import { registerMessageHandler } from "./handlers/message.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createLogger } from "@piti/shared";

const logger = createLogger("bot");

export interface BotOptions {
  allowedUsers: string;
  mcpBridgeUrl?: string;
  billingUrl?: string;
  billingApiSecret?: string;
}

export function createBot(token: string, db: Database, dispatcher: Dispatcher, opts: BotOptions): Telegraf<Context> {
  const bot = new Telegraf(token);

  // Auth middleware (must be first)
  bot.use(createAuthMiddleware(opts.allowedUsers));

  // Rate limiting middleware — only block actual floods, let all normal messages through
  const recentMessages = new Map<number, number[]>();
  const RATE_WINDOW_MS = 5_000;
  const RATE_MAX_MESSAGES = 20;

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const now = Date.now();
    const timestamps = (recentMessages.get(userId) ?? []).filter(
      (t) => now - t < RATE_WINDOW_MS
    );

    if (timestamps.length >= RATE_MAX_MESSAGES) {
      logger.warn("Rate limit exceeded", { userId, count: timestamps.length });
      return; // Drop — likely a flood
    }

    timestamps.push(now);
    recentMessages.set(userId, timestamps);
    return next();
  });

  // Register handlers (order matters: skills/reminders text handlers must be before message handler)
  registerSkillsHandlers(bot, db);
  registerRemindersHandlers(bot, db);
  registerCommandHandlers(bot, db, {
    mcpBridgeUrl: opts.mcpBridgeUrl,
    billingUrl: opts.billingUrl,
    billingApiSecret: opts.billingApiSecret,
  });
  registerMessageHandler(bot, dispatcher);

  // Error handling
  bot.catch((err: any) => {
    logger.error("Bot error", { error: err });
  });

  return bot;
}
