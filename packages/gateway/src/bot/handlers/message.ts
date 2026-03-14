import type { Context } from "telegraf";
import type { Dispatcher } from "../../orchestrator/dispatcher.js";
import { createLogger } from "@piti/shared";

const logger = createLogger("message-handler");

// Track pending language confirmations: telegramId -> detected language
const pendingLanguageConfirm = new Map<number, string>();

export function registerMessageHandler(bot: any, dispatcher: Dispatcher) {
  // Handle callback queries for language confirmation
  bot.action(/^lang_(yes|no)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const action = ctx.match[1];
    const detectedLang = pendingLanguageConfirm.get(telegramId);

    if (!detectedLang) {
      await ctx.answerCbQuery("No pending language setting.");
      return;
    }

    pendingLanguageConfirm.delete(telegramId);

    if (action === "yes") {
      await dispatcher.setUserLanguage(telegramId, detectedLang);
      await ctx.answerCbQuery(`Language set to ${detectedLang}!`);
      await ctx.editMessageText(`✅ Language set to **${detectedLang}**. I'll always reply in ${detectedLang} from now on.`, {
        parse_mode: "Markdown",
      });
    } else {
      await ctx.answerCbQuery("Language kept as default.");
      await ctx.editMessageText("👍 Keeping default language (english). You can change it anytime with /language.");
    }
  });

  bot.on("text", async (ctx: Context) => {
    const text = (ctx.message as any)?.text;
    const telegramId = ctx.from?.id;

    if (!text || !telegramId) return;

    // Ignore commands (handled separately)
    if (text.startsWith("/")) return;

    try {
      // Show typing indicator
      await ctx.sendChatAction("typing");

      const result = await dispatcher.dispatch(
        telegramId,
        text,
        ctx.from?.username,
        ctx.from?.first_name
      );

      // Send the agent reply
      await sendReply(ctx, result.reply);

      // If new user and language detected (different from default), ask to confirm
      if (
        result.isNewUser &&
        result.detectedLanguage &&
        result.detectedLanguage !== "english"
      ) {
        pendingLanguageConfirm.set(telegramId, result.detectedLanguage);
        await ctx.reply(
          `🌍 I detected you're writing in **${result.detectedLanguage}**. Want me to always reply in ${result.detectedLanguage}?`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: `✅ Yes, use ${result.detectedLanguage}`, callback_data: "lang_yes" },
                  { text: "❌ No, keep English", callback_data: "lang_no" },
                ],
              ],
            },
          } as any
        );
      }
    } catch (err) {
      logger.error("Error processing message", { telegramId, error: err });
      await ctx.reply(
        "Sorry, I encountered an error processing your message. Please try again."
      );
    }
  });
}

async function sendReply(ctx: Context, reply: string) {
  if (reply.length > 4096) {
    const chunks = splitMessage(reply, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() =>
        ctx.reply(chunk)
      );
    }
  } else {
    await ctx.reply(reply, { parse_mode: "Markdown" }).catch(() =>
      ctx.reply(reply)
    );
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
