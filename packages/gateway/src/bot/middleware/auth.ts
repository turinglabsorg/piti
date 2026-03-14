import type { Context, MiddlewareFn } from "telegraf";
import { createLogger } from "@piti/shared";

const logger = createLogger("auth");

export function createAuthMiddleware(allowedUsers: string): MiddlewareFn<Context> {
  const allowedSet = parseAllowedUsers(allowedUsers);
  const isRestricted = allowedSet.size > 0;

  if (isRestricted) {
    logger.info("Bot restricted to specific users", {
      count: allowedSet.size,
      users: [...allowedSet],
    });
  } else {
    logger.info("Bot open to all users");
  }

  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    if (isRestricted && !allowedSet.has(telegramId)) {
      logger.warn("Unauthorized user attempted access", {
        telegramId,
        username: ctx.from?.username,
      });
      await ctx.reply("⛔ Sorry, this bot is private. You are not authorized to use it.");
      return;
    }

    return next();
  };
}

function parseAllowedUsers(envValue: string): Set<number> {
  if (!envValue || envValue.trim() === "") {
    return new Set();
  }

  return new Set(
    envValue
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number)
      .filter((n) => !isNaN(n))
  );
}
