import type { Context } from "telegraf";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { users, messages, memories, tokenUsage, mcpCalls } from "../../db/schema.js";
import { LLM_PROVIDERS, LLM_MODELS } from "@piti/shared";

const creditsTranslations: Record<string, Record<string, string>> = {
  english: { title: "Your Credits", plan: "Plan", remaining: "Credits remaining", costs: "Credit costs", simple: "Simple question", detailed: "Detailed plan", vision: "Photo/video analysis", search: "Web search", credit: "credit", credits: "credits" },
  italian: { title: "I tuoi Crediti", plan: "Piano", remaining: "Crediti rimanenti", costs: "Costi crediti", simple: "Domanda semplice", detailed: "Piano dettagliato", vision: "Analisi foto/video", search: "Ricerca web", credit: "credito", credits: "crediti" },
  spanish: { title: "Tus Creditos", plan: "Plan", remaining: "Creditos restantes", costs: "Costos de creditos", simple: "Pregunta simple", detailed: "Plan detallado", vision: "Analisis foto/video", search: "Busqueda web", credit: "credito", credits: "creditos" },
  french: { title: "Vos Credits", plan: "Forfait", remaining: "Credits restants", costs: "Couts des credits", simple: "Question simple", detailed: "Plan detaille", vision: "Analyse photo/video", search: "Recherche web", credit: "credit", credits: "credits" },
  german: { title: "Deine Credits", plan: "Plan", remaining: "Verbleibende Credits", costs: "Credit-Kosten", simple: "Einfache Frage", detailed: "Detaillierter Plan", vision: "Foto/Video-Analyse", search: "Websuche", credit: "Credit", credits: "Credits" },
  portuguese: { title: "Seus Creditos", plan: "Plano", remaining: "Creditos restantes", costs: "Custos de creditos", simple: "Pergunta simples", detailed: "Plano detalhado", vision: "Analise foto/video", search: "Pesquisa web", credit: "credito", credits: "creditos" },
};

export interface CommandHandlerOpts {
  mcpBridgeUrl?: string;
  billingUrl?: string;
  billingApiSecret?: string;
}

export function registerCommandHandlers(
  bot: any,
  db: Database,
  opts: CommandHandlerOpts = {}
) {
  bot.command("start", async (ctx: Context) => {
    await ctx.reply(
      "🏋️ Welcome to PITI - Your Personal AI Trainer!\n\n" +
        "I'm here to help you with:\n" +
        "• Workout plans & exercise guidance\n" +
        "• Nutrition & meal planning\n" +
        "• Health tracking & progress\n" +
        "• General fitness advice\n\n" +
        "Commands:\n" +
        "/profile - View/update your profile\n" +
        "/provider - Change LLM provider\n" +
        "/language - Set your preferred language\n" +
        "/memories - View what I remember about you\n" +
        "/reset - Reset conversation history\n" +
        "/status - View agent status & MCP services\n" +
        "/credits - Check your credit balance\n" +
        "/help - Show this message\n\n" +
        "Just send me a message to get started!"
    );
  });

  bot.command("help", async (ctx: Context) => {
    await ctx.reply(
      "📋 PITI Commands:\n\n" +
        "/profile - View your fitness profile\n" +
        "/provider - Switch LLM provider (claude/kimi/openrouter)\n" +
        "/language - Set your preferred language\n" +
        "/memories - View stored memories\n" +
        "/reset - Clear conversation history\n" +
        "/status - View agent status & MCP services\n" +
        "/help - Show this message"
    );
  });

  bot.command("provider", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const text = (ctx.message as any)?.text || "";
    const args = text.split(" ").slice(1);

    if (args.length === 0) {
      const providerList = LLM_PROVIDERS.map((p) => {
        const models = LLM_MODELS[p].join(", ");
        return `• ${p}: ${models}`;
      }).join("\n");

      await ctx.reply(
        `Available providers:\n${providerList}\n\n` +
          `Usage: /provider <name> [model]\n` +
          `Example: /provider claude claude-sonnet-4-20250514`
      );
      return;
    }

    const provider = args[0] as string;
    if (!LLM_PROVIDERS.includes(provider as any)) {
      await ctx.reply(`Unknown provider. Available: ${LLM_PROVIDERS.join(", ")}`);
      return;
    }

    const model = args[1] || LLM_MODELS[provider as keyof typeof LLM_MODELS][0];

    await db
      .update(users)
      .set({ llmProvider: provider, llmModel: model })
      .where(eq(users.telegramId, telegramId));

    await ctx.reply(`✅ Provider set to ${provider} (model: ${model})`);
  });

  const SUPPORTED_LANGUAGES = [
    "english", "italian", "french", "spanish", "german",
    "portuguese", "chinese", "japanese", "korean", "russian", "arabic",
  ];

  bot.command("language", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const text = (ctx.message as any)?.text || "";
    const args = text.split(" ").slice(1);

    if (args.length === 0) {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);

      const currentLang = user.length > 0 ? user[0].language : "english";

      await ctx.reply(
        `🌍 Current language: **${currentLang}**\n\n` +
          `Available: ${SUPPORTED_LANGUAGES.join(", ")}\n\n` +
          `Usage: /language <name>\n` +
          `Example: /language italian`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const language = args[0].toLowerCase();
    if (!SUPPORTED_LANGUAGES.includes(language)) {
      await ctx.reply(
        `Unknown language. Available: ${SUPPORTED_LANGUAGES.join(", ")}\n\n` +
          `You can also type any language name and I'll try to use it.`
      );
      return;
    }

    await db
      .update(users)
      .set({ language })
      .where(eq(users.telegramId, telegramId));

    await ctx.reply(`✅ Language set to **${language}**. I'll reply in ${language} from now on!`, {
      parse_mode: "Markdown",
    });
  });

  bot.command("memories", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (user.length === 0) {
      await ctx.reply("No profile found. Send me a message to get started!");
      return;
    }

    const userMemories = await db
      .select()
      .from(memories)
      .where(eq(memories.userId, user[0].id))
      .limit(20);

    if (userMemories.length === 0) {
      await ctx.reply("No memories stored yet. Chat with me and I'll start remembering things about you!");
      return;
    }

    const memoryList = userMemories
      .map((m) => `[${m.category}] ${m.content}`)
      .join("\n");

    await ctx.reply(`🧠 What I remember about you:\n\n${memoryList}`);
  });

  bot.command("profile", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (user.length === 0 || !user[0].profile || Object.keys(user[0].profile).length === 0) {
      await ctx.reply(
        "No profile set up yet. Tell me about yourself:\n" +
          "• Your age, height, weight\n" +
          "• Fitness goals\n" +
          "• Any injuries or restrictions\n" +
          "• Experience level\n\n" +
          "I'll remember everything!"
      );
      return;
    }

    const profile = user[0].profile as Record<string, unknown>;
    const lines = Object.entries(profile)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\n");

    await ctx.reply(`📊 Your Profile:\n\n${lines}`);
  });

  bot.command("status", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (user.length === 0) {
      await ctx.reply("No profile found. Send a message to get started!");
      return;
    }

    // Get token usage stats
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

    // Get MCP tools info
    let mcpInfo = "No MCP services connected";
    if (opts.mcpBridgeUrl) {
      try {
        const resp = await fetch(`${opts.mcpBridgeUrl}/tools`, {
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { tools: { name: string; description: string }[] };
          if (data.tools.length > 0) {
            mcpInfo = data.tools.map((t) => `• ${t.name}`).join("\n");
          } else {
            mcpInfo = "Bridge running, no tools loaded";
          }
        }
      } catch {
        mcpInfo = "Bridge unreachable";
      }
    }

    // Build status message
    let statusMsg = `<b>PITI Status</b>\n\n`;
    statusMsg += `<b>User:</b> ${user[0].username || user[0].firstName || "Unknown"}\n`;
    statusMsg += `<b>Language:</b> ${user[0].language}\n`;
    statusMsg += `<b>Provider:</b> ${user[0].llmProvider}\n`;
    statusMsg += `<b>Model:</b> ${user[0].llmModel}\n\n`;

    statusMsg += `<b>Token Usage:</b>\n`;
    if (usageStats.length === 0) {
      statusMsg += `No usage yet\n`;
    } else {
      for (const s of usageStats) {
        statusMsg += `• ${s.model}: ${s.calls} calls, ${s.totalIn} in / ${s.totalOut} out\n`;
      }
    }

    // Get MCP call stats
    const mcpStats = await db
      .select({
        tool: mcpCalls.tool,
        server: mcpCalls.server,
        calls: sql<number>`COUNT(*)`,
        avgMs: sql<number>`ROUND(AVG(${mcpCalls.durationMs}))`,
      })
      .from(mcpCalls)
      .where(eq(mcpCalls.userId, user[0].id))
      .groupBy(mcpCalls.server, mcpCalls.tool);

    statusMsg += `\n<b>MCP Services:</b>\n${mcpInfo}`;

    if (mcpStats.length > 0) {
      statusMsg += `\n\n<b>MCP Usage:</b>\n`;
      for (const s of mcpStats) {
        statusMsg += `• ${s.server}/${s.tool}: ${s.calls} calls, avg ${s.avgMs}ms\n`;
      }
    }

    await ctx.reply(statusMsg, { parse_mode: "HTML" });
  });

  bot.command("credits", async (ctx: Context) => {
    if (!opts.billingUrl) {
      await ctx.reply("Enjoy PITI for free! No credit limits on this instance.");
      return;
    }

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const billingHeaders: Record<string, string> = {};
      if (opts.billingApiSecret) {
        billingHeaders["x-api-secret"] = opts.billingApiSecret;
      }

      const resp = await fetch(`${opts.billingUrl}/balance/${telegramId}`, {
        signal: AbortSignal.timeout(5000),
        headers: billingHeaders,
      });

      if (!resp.ok) {
        await ctx.reply("Could not check credits. Try again later.");
        return;
      }

      const data = (await resp.json()) as { telegramId: number; credits: number; plan: string };

      // Get user language
      const userRow = await db
        .select()
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
      const lang = userRow.length > 0 ? userRow[0].language : "english";
      const t = creditsTranslations[lang] || creditsTranslations.english;

      let msg = `<b>${t.title}</b>\n\n`;
      msg += `${t.plan}: <b>${data.plan}</b>\n`;
      msg += `${t.remaining}: <b>${data.credits}</b>\n\n`;
      msg += `<b>${t.costs}:</b>\n`;
      msg += `• ${t.simple}: 1 ${t.credit}\n`;
      msg += `• ${t.detailed}: 3 ${t.credits}\n`;
      msg += `• ${t.vision}: 5 ${t.credits}\n`;
      msg += `• ${t.search}: +1 ${t.credit}\n`;

      if (data.credits <= 10) {
        const starterResp = await fetch(`${opts.billingUrl}/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...billingHeaders },
          body: JSON.stringify({ telegramId, plan: "starter" }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);

        if (starterResp?.ok) {
          const { url } = (await starterResp.json()) as { url: string };
          msg += `\n<a href="${url}">Buy Starter (300 credits) - $9.99/month</a>`;
        }
      }

      await ctx.reply(msg, { parse_mode: "HTML" });
    } catch {
      await ctx.reply("Could not check credits. Try again later.");
    }
  });

  bot.command("reset", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (user.length === 0) return;

    await db.delete(messages).where(eq(messages.userId, user[0].id));
    await ctx.reply("🗑️ Conversation history cleared. Your memories are preserved.");
  });
}
