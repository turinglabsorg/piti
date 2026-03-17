import type { Context } from "telegraf";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { users, messages, memories, tokenUsage, mcpCalls } from "../../db/schema.js";

const creditsTranslations: Record<string, Record<string, string>> = {
  english: { title: "Your Credits", plan: "Plan", remaining: "Credits remaining", costs: "Credit costs", simple: "Simple question", detailed: "Detailed plan", vision: "Photo/video analysis", search: "Web search", credit: "credit", credits: "credits" },
  italian: { title: "I tuoi Crediti", plan: "Piano", remaining: "Crediti rimanenti", costs: "Costi crediti", simple: "Domanda semplice", detailed: "Piano dettagliato", vision: "Analisi foto/video", search: "Ricerca web", credit: "credito", credits: "crediti" },
  spanish: { title: "Tus Créditos", plan: "Plan", remaining: "Créditos restantes", costs: "Costos de créditos", simple: "Pregunta simple", detailed: "Plan detallado", vision: "Análisis foto/video", search: "Búsqueda web", credit: "crédito", credits: "créditos" },
  french: { title: "Vos Crédits", plan: "Forfait", remaining: "Crédits restants", costs: "Coûts des crédits", simple: "Question simple", detailed: "Plan détaillé", vision: "Analyse photo/vidéo", search: "Recherche web", credit: "crédit", credits: "crédits" },
  german: { title: "Deine Credits", plan: "Plan", remaining: "Verbleibende Credits", costs: "Credit-Kosten", simple: "Einfache Frage", detailed: "Detaillierter Plan", vision: "Foto/Video-Analyse", search: "Websuche", credit: "Credit", credits: "Credits" },
  portuguese: { title: "Seus Créditos", plan: "Plano", remaining: "Créditos restantes", costs: "Custos de créditos", simple: "Pergunta simples", detailed: "Plano detalhado", vision: "Análise foto/vídeo", search: "Pesquisa web", credit: "crédito", credits: "créditos" },
};

const LANGUAGE_KEYBOARD = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "\u{1F1EC}\u{1F1E7}", callback_data: "setlang_english" },
        { text: "\u{1F1EE}\u{1F1F9}", callback_data: "setlang_italian" },
        { text: "\u{1F1EA}\u{1F1F8}", callback_data: "setlang_spanish" },
        { text: "\u{1F1EB}\u{1F1F7}", callback_data: "setlang_french" },
        { text: "\u{1F1E9}\u{1F1EA}", callback_data: "setlang_german" },
        { text: "\u{1F1E7}\u{1F1F7}", callback_data: "setlang_portuguese" },
      ],
    ],
  },
};

export interface CommandHandlerOpts {
  mcpBridgeUrl?: string;
  billingUrl?: string;
  billingApiSecret?: string;
}

async function getUserLang(db: Database, telegramId: number): Promise<string> {
  const row = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return row.length > 0 ? row[0].language : "english";
}

export function registerCommandHandlers(
  bot: any,
  db: Database,
  opts: CommandHandlerOpts = {}
) {
  // /start — welcome + language picker
  bot.command("start", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    await ctx.reply(
      "Welcome to PITI! Your AI fitness & nutrition buddy.\n\n" +
        "First, choose your language:",
      LANGUAGE_KEYBOARD as any
    );
  });

  // /help — list commands
  bot.command("help", async (ctx: Context) => {
    await ctx.reply(
      "PITI Commands:\n\n" +
        "/language - Change language\n" +
        "/profile - View your fitness profile\n" +
        "/subscription - Manage your plan\n" +
        "/credits - Check credit balance\n" +
        "/status - View agent status\n" +
        "/reset - Clear conversation history\n" +
        "/help - Show this message"
    );
  });

  // /language — flag picker
  bot.command("language", async (ctx: Context) => {
    await ctx.reply("Choose your language:", LANGUAGE_KEYBOARD as any);
  });

  // /profile — show memories grouped as a profile summary
  bot.command("profile", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (user.length === 0) {
      await ctx.reply("Send me a message to get started!");
      return;
    }

    const userMemories = await db.select().from(memories).where(eq(memories.userId, user[0].id)).limit(30);

    if (userMemories.length === 0) {
      await ctx.reply(
        "No profile yet. Tell me about yourself:\n" +
          "- Age, height, weight\n" +
          "- Fitness goals\n" +
          "- Injuries or restrictions\n" +
          "- Experience level"
      );
      return;
    }

    // Group memories by category
    const groups: Record<string, string[]> = {};
    for (const m of userMemories) {
      if (!groups[m.category]) groups[m.category] = [];
      groups[m.category].push(m.content);
    }

    const categoryLabels: Record<string, string> = {
      personal: "Personal",
      goal: "Goals",
      routine: "Routine",
      progress: "Progress",
      injury: "Injuries",
      nutrition: "Nutrition",
      health: "Health",
      preference: "Preferences",
    };

    let msg = `<b>Your Profile</b>\n`;
    msg += `Language: ${user[0].language}\n\n`;

    for (const [cat, items] of Object.entries(groups)) {
      const label = categoryLabels[cat] || cat;
      msg += `<b>${label}:</b>\n`;
      for (const item of items) {
        msg += `- ${item}\n`;
      }
      msg += `\n`;
    }

    await ctx.reply(msg.trim(), { parse_mode: "HTML" });
  });

  // /status
  bot.command("status", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (user.length === 0) {
      await ctx.reply("Send a message to get started!");
      return;
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

    let mcpInfo = "No MCP services connected";
    if (opts.mcpBridgeUrl) {
      try {
        const resp = await fetch(`${opts.mcpBridgeUrl}/tools`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const data = (await resp.json()) as { tools: { name: string }[] };
          mcpInfo = data.tools.length > 0
            ? data.tools.map((t) => `- ${t.name}`).join("\n")
            : "Bridge running, no tools loaded";
        }
      } catch {
        mcpInfo = "Bridge unreachable";
      }
    }

    const mcpStats = await db
      .select({
        tool: mcpCalls.tool, server: mcpCalls.server,
        calls: sql<number>`COUNT(*)`,
        avgMs: sql<number>`ROUND(AVG(${mcpCalls.durationMs}))`,
      })
      .from(mcpCalls)
      .where(eq(mcpCalls.userId, user[0].id))
      .groupBy(mcpCalls.server, mcpCalls.tool);

    let msg = `<b>PITI Status</b>\n\n`;
    msg += `<b>Language:</b> ${user[0].language}\n\n`;

    msg += `<b>Token Usage:</b>\n`;
    if (usageStats.length === 0) {
      msg += `No usage yet\n`;
    } else {
      for (const s of usageStats) {
        msg += `- ${s.model}: ${s.calls} calls\n`;
      }
    }

    msg += `\n<b>MCP Tools:</b>\n${mcpInfo}`;

    if (mcpStats.length > 0) {
      msg += `\n\n<b>MCP Usage:</b>\n`;
      for (const s of mcpStats) {
        msg += `- ${s.server}/${s.tool}: ${s.calls} calls, avg ${s.avgMs}ms\n`;
      }
    }

    await ctx.reply(msg, { parse_mode: "HTML" });
  });

  // /subscription — show plan or buy
  bot.command("subscription", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    if (!opts.billingUrl) {
      await ctx.reply("Enjoy PITI for free! No subscription needed on this instance.");
      return;
    }

    try {
      const lang = await getUserLang(db, telegramId);
      const loadingMsgs: Record<string, string> = {
        english: "Retrieving subscription status...",
        italian: "Recupero stato abbonamento...",
        spanish: "Recuperando estado de suscripción...",
        french: "Récupération du statut d'abonnement...",
        german: "Abonnementstatus wird abgerufen...",
        portuguese: "Recuperando status da assinatura...",
      };
      await ctx.reply(loadingMsgs[lang] || loadingMsgs.english);

      const billingHeaders: Record<string, string> = {};
      if (opts.billingApiSecret) billingHeaders["x-api-secret"] = opts.billingApiSecret;

      // Check subscription status
      const subResp = await fetch(`${opts.billingUrl}/subscription/${telegramId}`, {
        signal: AbortSignal.timeout(15000),
        headers: billingHeaders,
      });

      if (!subResp.ok) {
        const errText = await subResp.text().catch(() => "");
        await ctx.reply(`Could not load subscription info (${subResp.status}). Try again later.`);
        return;
      }

      const sub = (await subResp.json()) as {
        active: boolean;
        status?: string;
        plan: string;
        credits: number;
        currentPeriodStart?: string;
        currentPeriodEnd?: string;
        cancelAtPeriodEnd?: boolean;
      };

      if (sub.active) {
        const planName = sub.plan === "starter" ? "Starter ($9.99/month)" : "Pro ($24.99/month)";
        const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : "—";

        let msg = "";
        if (sub.cancelAtPeriodEnd) {
          msg += `<b>Plan: ${planName} (cancelling)</b>\n\n`;
          msg += `Credits: <b>${sub.credits}</b>\n`;
          msg += `Active until: ${end}\n`;
          msg += `\nYour subscription will not renew. You can keep using your remaining credits until the end of the period.`;
        } else {
          msg += `<b>Plan: ${planName}</b>\n\n`;
          msg += `Credits: <b>${sub.credits}</b>\n`;
          msg += `Renews: ${end}\n`;
        }

        const keyboard = [];

        // Stripe portal for manage/cancel/reactivate
        const portalResp = await fetch(`${opts.billingUrl}/subscription/${telegramId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...billingHeaders },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        if (portalResp?.ok) {
          const { url } = (await portalResp.json()) as { url: string };
          if (sub.cancelAtPeriodEnd) {
            keyboard.push([{ text: "Reactivate Subscription", url }]);
          } else {
            keyboard.push([{ text: "Manage Subscription", url }]);
          }
        }

        // Always show change plan options
        const otherPlan = sub.plan === "starter" ? "pro" : "starter";
        const otherLabel = otherPlan === "pro" ? "Upgrade to Pro ($24.99/mo)" : "Downgrade to Starter ($9.99/mo)";
        const changeResp = await fetch(`${opts.billingUrl}/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...billingHeaders },
          body: JSON.stringify({ telegramId, plan: otherPlan }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        if (changeResp?.ok) {
          const { url } = (await changeResp.json()) as { url: string };
          keyboard.push([{ text: otherLabel, url }]);
        }

        await ctx.reply(msg, {
          parse_mode: "HTML",
          reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
        } as any);
        return;
      }

      // No active subscription — show buy options
      const keyboard = [];

      const starterResp = await fetch(`${opts.billingUrl}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...billingHeaders },
        body: JSON.stringify({ telegramId, plan: "starter" }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      const proResp = await fetch(`${opts.billingUrl}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...billingHeaders },
        body: JSON.stringify({ telegramId, plan: "pro" }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (starterResp?.ok) {
        const { url } = (await starterResp.json()) as { url: string };
        keyboard.push([{ text: "Starter — 300 credits — $9.99/mo", url }]);
      }
      if (proResp?.ok) {
        const { url } = (await proResp.json()) as { url: string };
        keyboard.push([{ text: "Pro — 1000 credits — $24.99/mo", url }]);
      }

      await ctx.reply(
        `<b>Free Plan</b>\nCredits: <b>${sub.credits}</b>\n\nUpgrade to get more credits:`,
        {
          parse_mode: "HTML",
          reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
        } as any
      );
    } catch (err: any) {
      await ctx.reply(`Could not load subscription info: ${err?.message || "unknown error"}`);
    }
  });

  // /credits
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
      const lang = await getUserLang(db, telegramId);
      const t = creditsTranslations[lang] || creditsTranslations.english;

      let msg = `<b>${t.title}</b>\n\n`;
      msg += `${t.plan}: <b>${data.plan}</b>\n`;
      msg += `${t.remaining}: <b>${data.credits}</b>\n\n`;
      msg += `<b>${t.costs}:</b>\n`;
      msg += `- ${t.simple}: 1 ${t.credit}\n`;
      msg += `- ${t.detailed}: 3 ${t.credits}\n`;
      msg += `- ${t.vision}: 5 ${t.credits}\n`;
      msg += `- ${t.search}: +1 ${t.credit}\n`;

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

  // /reset — confirmation first
  const resetTranslations: Record<string, { confirm: string; yes: string; no: string; done: string; cancelled: string }> = {
    english: { confirm: "Are you sure you want to clear your conversation history? Your memories will be preserved.", yes: "Yes, clear", no: "Cancel", done: "Conversation history cleared.", cancelled: "Cancelled." },
    italian: { confirm: "Sei sicuro di voler cancellare la cronologia delle conversazioni? I tuoi ricordi saranno preservati.", yes: "Sì, cancella", no: "Annulla", done: "Cronologia cancellata.", cancelled: "Annullato." },
    spanish: { confirm: "¿Estás seguro de que quieres borrar el historial de conversaciones? Tus recuerdos se conservarán.", yes: "Sí, borrar", no: "Cancelar", done: "Historial borrado.", cancelled: "Cancelado." },
    french: { confirm: "Êtes-vous sûr de vouloir effacer l'historique des conversations ? Vos souvenirs seront préservés.", yes: "Oui, effacer", no: "Annuler", done: "Historique effacé.", cancelled: "Annulé." },
    german: { confirm: "Bist du sicher, dass du den Gesprächsverlauf löschen willst? Deine Erinnerungen bleiben erhalten.", yes: "Ja, löschen", no: "Abbrechen", done: "Verlauf gelöscht.", cancelled: "Abgebrochen." },
    portuguese: { confirm: "Tem certeza que deseja limpar o histórico de conversas? Suas memórias serão preservadas.", yes: "Sim, limpar", no: "Cancelar", done: "Histórico limpo.", cancelled: "Cancelado." },
  };

  bot.command("reset", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang = await getUserLang(db, telegramId);
    const t = resetTranslations[lang] || resetTranslations.english;

    await ctx.reply(t.confirm, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: t.yes, callback_data: "reset_yes" },
            { text: t.no, callback_data: "reset_no" },
          ],
        ],
      },
    } as any);
  });

  // Reset confirmation callbacks
  bot.action("reset_yes", async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (user.length === 0) return;

    await db.delete(messages).where(eq(messages.userId, user[0].id));

    const lang = user[0].language;
    const t = resetTranslations[lang] || resetTranslations.english;
    await ctx.answerCbQuery(t.done);
    await ctx.editMessageText(t.done);
  });

  bot.action("reset_no", async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang = await getUserLang(db, telegramId);
    const t = resetTranslations[lang] || resetTranslations.english;
    await ctx.answerCbQuery(t.cancelled);
    await ctx.editMessageText(t.cancelled);
  });
}
