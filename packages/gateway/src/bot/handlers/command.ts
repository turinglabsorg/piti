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

const referralTranslations: Record<string, Record<string, string>> = {
  english: {
    title: "Invite Friends & Earn Credits",
    share: "Share this link with friends:",
    howItWorks: "When someone joins using your link, you both get <b>+15 credits</b>!\nIf they subscribe, you get an extra <b>+50 credits</b>!",
    stats: "Your referrals: <b>{count}</b> | Credits earned: <b>{earned}</b>",
    signupBonusReferred: "You got +{credits} bonus credits from a referral! Welcome to PITI!",
    signupBonusReferrer: "<b>Someone joined with your link!</b>\n\nYou earned <b>+{credits} credits</b> as a referral reward!",
    error: "Could not load referral info. Try again later.",
  },
  italian: {
    title: "Invita Amici e Guadagna Crediti",
    share: "Condividi questo link con i tuoi amici:",
    howItWorks: "Quando qualcuno si unisce con il tuo link, entrambi ricevete <b>+15 crediti</b>!\nSe si abbona, ricevi <b>+50 crediti</b> extra!",
    stats: "I tuoi referral: <b>{count}</b> | Crediti guadagnati: <b>{earned}</b>",
    signupBonusReferred: "Hai ricevuto +{credits} crediti bonus da un referral! Benvenuto su PITI!",
    signupBonusReferrer: "<b>Qualcuno si e' unito con il tuo link!</b>\n\nHai guadagnato <b>+{credits} crediti</b> come premio referral!",
    error: "Impossibile caricare le info referral. Riprova piu' tardi.",
  },
  spanish: {
    title: "Invita Amigos y Gana Creditos",
    share: "Comparte este enlace con tus amigos:",
    howItWorks: "Cuando alguien se une con tu enlace, ambos reciben <b>+15 creditos</b>!\nSi se suscribe, ganas <b>+50 creditos</b> extra!",
    stats: "Tus referidos: <b>{count}</b> | Creditos ganados: <b>{earned}</b>",
    signupBonusReferred: "Recibiste +{credits} creditos de bonus por referido! Bienvenido a PITI!",
    signupBonusReferrer: "<b>Alguien se unio con tu enlace!</b>\n\nGanaste <b>+{credits} creditos</b> como recompensa de referido!",
    error: "No se pudo cargar la info de referidos. Intentalo mas tarde.",
  },
  french: {
    title: "Invitez des Amis et Gagnez des Credits",
    share: "Partagez ce lien avec vos amis :",
    howItWorks: "Quand quelqu'un rejoint avec votre lien, vous recevez tous les deux <b>+15 credits</b> !\nS'il s'abonne, vous gagnez <b>+50 credits</b> en plus !",
    stats: "Vos parrainages : <b>{count}</b> | Credits gagnes : <b>{earned}</b>",
    signupBonusReferred: "Vous avez recu +{credits} credits bonus grace a un parrainage ! Bienvenue sur PITI !",
    signupBonusReferrer: "<b>Quelqu'un a rejoint avec votre lien !</b>\n\nVous avez gagne <b>+{credits} credits</b> en recompense de parrainage !",
    error: "Impossible de charger les infos de parrainage. Reessayez plus tard.",
  },
  german: {
    title: "Freunde einladen & Credits verdienen",
    share: "Teile diesen Link mit Freunden:",
    howItWorks: "Wenn jemand deinem Link folgt, bekommt ihr beide <b>+15 Credits</b>!\nWenn sie abonnieren, bekommst du <b>+50 Credits</b> extra!",
    stats: "Deine Empfehlungen: <b>{count}</b> | Credits verdient: <b>{earned}</b>",
    signupBonusReferred: "Du hast +{credits} Bonus-Credits durch eine Empfehlung erhalten! Willkommen bei PITI!",
    signupBonusReferrer: "<b>Jemand ist deinem Link gefolgt!</b>\n\nDu hast <b>+{credits} Credits</b> als Empfehlungsbelohnung verdient!",
    error: "Empfehlungsinfos konnten nicht geladen werden. Versuche es spaeter erneut.",
  },
  portuguese: {
    title: "Convide Amigos e Ganhe Creditos",
    share: "Compartilhe este link com amigos:",
    howItWorks: "Quando alguem entra pelo seu link, ambos recebem <b>+15 creditos</b>!\nSe assinar, voce ganha <b>+50 creditos</b> extras!",
    stats: "Suas indicacoes: <b>{count}</b> | Creditos ganhos: <b>{earned}</b>",
    signupBonusReferred: "Voce ganhou +{credits} creditos de bonus por indicacao! Bem-vindo ao PITI!",
    signupBonusReferrer: "<b>Alguem entrou pelo seu link!</b>\n\nVoce ganhou <b>+{credits} creditos</b> como recompensa de indicacao!",
    error: "Nao foi possivel carregar as infos de indicacao. Tente novamente mais tarde.",
  },
};

export interface CommandHandlerOpts {
  mcpBridgeUrl?: string;
  billingUrl?: string;
  billingApiSecret?: string;
}

/** Escape HTML special characters to prevent injection in Telegram HTML messages */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  // /start — welcome + language picker + referral deep link
  bot.command("start", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    // Parse deep link payload: /start ref_X7K9M2
    const text = (ctx.message as any)?.text || "";
    const payload = text.split(" ").slice(1).join("").trim();
    const referralMatch = payload.match(/^ref_([A-Z0-9]{6,8})$/i);

    if (referralMatch && opts.billingUrl && opts.billingApiSecret) {
      const referralCode = referralMatch[1].toUpperCase();
      // Store for after user creation — apply referral asynchronously
      setTimeout(async () => {
        try {
          const billingHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "x-api-secret": opts.billingApiSecret!,
          };
          const resp = await fetch(`${opts.billingUrl}/referral/apply-signup`, {
            method: "POST",
            headers: billingHeaders,
            body: JSON.stringify({ referredTelegramId: telegramId, referralCode }),
            signal: AbortSignal.timeout(30000),
          });

          if (resp.ok) {
            const data = (await resp.json()) as { referrerTelegramId?: string; creditsAdded?: number };
            const lang = await getUserLang(db, telegramId).catch(() => "english");
            const t = referralTranslations[lang] || referralTranslations.english;

            // Notify the referred user
            await ctx.reply(t.signupBonusReferred.replace("{credits}", String(data.creditsAdded || 15)));

            // Notify the referrer via Telegram API
            if (data.referrerTelegramId) {
              const referrerLang = await getUserLang(db, parseInt(data.referrerTelegramId)).catch(() => "english");
              const rt = referralTranslations[referrerLang] || referralTranslations.english;
              const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
              if (botToken) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: data.referrerTelegramId,
                    text: rt.signupBonusReferrer.replace("{credits}", String(data.creditsAdded || 15)),
                    parse_mode: "HTML",
                  }),
                }).catch(() => {});
              }
            }
          }
        } catch {
          // Referral failure should not block onboarding
        }
      }, 2000); // Delay to allow user creation via /balance first
    }

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
        "/referral - Invite friends & earn credits\n" +
        "/redeem - Redeem a coupon code\n" +
        "/status - View agent status\n" +
        "/reset - Clear conversation history\n" +
        "/help - Show this message"
    );
  });

  // /language — flag picker
  bot.command("language", async (ctx: Context) => {
    await ctx.reply("Choose your language:", LANGUAGE_KEYBOARD as any);
  });

  // /referral — show referral link and stats
  bot.command("referral", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    if (!opts.billingUrl) {
      await ctx.reply("Referrals are not available on this instance.");
      return;
    }

    const lang = await getUserLang(db, telegramId);
    const t = referralTranslations[lang] || referralTranslations.english;

    try {
      const billingHeaders: Record<string, string> = {};
      if (opts.billingApiSecret) billingHeaders["x-api-secret"] = opts.billingApiSecret;

      const [codeResp, statsResp] = await Promise.all([
        fetch(`${opts.billingUrl}/referral/code/${telegramId}`, {
          signal: AbortSignal.timeout(30000),
          headers: billingHeaders,
        }),
        fetch(`${opts.billingUrl}/referral/stats/${telegramId}`, {
          signal: AbortSignal.timeout(30000),
          headers: billingHeaders,
        }),
      ]);

      if (!codeResp.ok || !statsResp.ok) {
        await ctx.reply(t.error);
        return;
      }

      const { referralCode } = (await codeResp.json()) as { referralCode: string };
      const stats = (await statsResp.json()) as { referralCount: number; referralCreditsEarned: number };

      const link = `https://t.me/piti_ai_bot?start=ref_${referralCode}`;

      let msg = `<b>${t.title}</b>\n\n`;
      msg += `${t.share}\n<code>${link}</code>\n\n`;
      msg += `${t.howItWorks}\n\n`;
      msg += t.stats
        .replace("{count}", String(stats.referralCount))
        .replace("{earned}", String(stats.referralCreditsEarned));

      await ctx.reply(msg, { parse_mode: "HTML" });
    } catch {
      await ctx.reply(t.error);
    }
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
    msg += `Language: ${escapeHtml(user[0].language)}\n\n`;

    for (const [cat, items] of Object.entries(groups)) {
      const label = categoryLabels[cat] || escapeHtml(cat);
      msg += `<b>${escapeHtml(label)}:</b>\n`;
      for (const item of items) {
        msg += `- ${escapeHtml(item)}\n`;
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
            ? data.tools.map((t) => `- ${escapeHtml(t.name)}`).join("\n")
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
    msg += `<b>Language:</b> ${escapeHtml(user[0].language)}\n\n`;

    msg += `<b>Token Usage:</b>\n`;
    if (usageStats.length === 0) {
      msg += `No usage yet\n`;
    } else {
      for (const s of usageStats) {
        msg += `- ${escapeHtml(s.model)}: ${s.calls} calls\n`;
      }
    }

    msg += `\n<b>MCP Tools:</b>\n${mcpInfo}`;

    if (mcpStats.length > 0) {
      msg += `\n\n<b>MCP Usage:</b>\n`;
      for (const s of mcpStats) {
        msg += `- ${escapeHtml(s.server)}/${escapeHtml(s.tool)}: ${s.calls} calls, avg ${s.avgMs}ms\n`;
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
        const subErrorMsgs: Record<string, string> = {
          english: "Could not load subscription info. Try again later.",
          italian: "Impossibile caricare le info sull'abbonamento. Riprova più tardi.",
          spanish: "No se pudo cargar la información de suscripción. Inténtalo más tarde.",
          french: "Impossible de charger les infos d'abonnement. Réessayez plus tard.",
          german: "Abo-Info konnte nicht geladen werden. Versuche es später erneut.",
          portuguese: "Não foi possível carregar as informações da assinatura. Tente novamente mais tarde.",
        };
        await ctx.reply(subErrorMsgs[lang] || subErrorMsgs.english);
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
        const planName = sub.plan === "starter" ? "Starter ($9.80/month)" : "Pro ($27.24/month)";
        const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : "—";

        let msg = "";
        if (sub.cancelAtPeriodEnd) {
          msg += `<b>Plan: ${escapeHtml(planName)} (cancelling)</b>\n\n`;
          msg += `Credits: <b>${sub.credits}</b>\n`;
          msg += `Active until: ${escapeHtml(end)}\n`;
          msg += `\nYour subscription will not renew. You can keep using your remaining credits until the end of the period.`;
        } else {
          msg += `<b>Plan: ${escapeHtml(planName)}</b>\n\n`;
          msg += `Credits: <b>${sub.credits}</b>\n`;
          msg += `Renews: ${escapeHtml(end)}\n`;
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
        const otherLabel = otherPlan === "pro" ? "Upgrade to Pro ($27.24/mo)" : "Downgrade to Starter ($9.80/mo)";
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
        signal: AbortSignal.timeout(30000),
      }).catch(() => null);

      const proResp = await fetch(`${opts.billingUrl}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...billingHeaders },
        body: JSON.stringify({ telegramId, plan: "pro" }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => null);

      if (starterResp?.ok) {
        const { url } = (await starterResp.json()) as { url: string };
        keyboard.push([{ text: "Starter — 300 credits — $9.80/mo", url }]);
      }
      if (proResp?.ok) {
        const { url } = (await proResp.json()) as { url: string };
        keyboard.push([{ text: "Pro — 1000 credits — $27.24/mo", url }]);
      }

      await ctx.reply(
        `<b>Free Plan</b>\nCredits: <b>${sub.credits}</b>\n\nUpgrade to get more credits:`,
        {
          parse_mode: "HTML",
          reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
        } as any
      );
    } catch {
      const subErrorMsgs2: Record<string, string> = {
        english: "Could not load subscription info. Try again later.",
        italian: "Impossibile caricare le info sull'abbonamento. Riprova più tardi.",
        spanish: "No se pudo cargar la información de suscripción. Inténtalo más tarde.",
        french: "Impossible de charger les infos d'abonnement. Réessayez plus tard.",
        german: "Abo-Info konnte nicht geladen werden. Versuche es später erneut.",
        portuguese: "Não foi possível carregar as informações da assinatura. Tente novamente mais tarde.",
      };
      const lang2 = await getUserLang(db, ctx.from?.id || 0).catch(() => "english");
      await ctx.reply(subErrorMsgs2[lang2] || subErrorMsgs2.english);
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

    const lang = await getUserLang(db, telegramId);
    const errorMsgs: Record<string, string> = {
      english: "Could not check credits. Try again later.",
      italian: "Impossibile verificare i crediti. Riprova più tardi.",
      spanish: "No se pudieron verificar los créditos. Inténtalo más tarde.",
      french: "Impossible de vérifier les crédits. Réessayez plus tard.",
      german: "Credits konnten nicht überprüft werden. Versuche es später erneut.",
      portuguese: "Não foi possível verificar os créditos. Tente novamente mais tarde.",
    };
    const loadingMsgs: Record<string, string> = {
      english: "Checking credits...",
      italian: "Controllo crediti...",
      spanish: "Verificando créditos...",
      french: "Vérification des crédits...",
      german: "Credits werden überprüft...",
      portuguese: "Verificando créditos...",
    };

    try {
      await ctx.reply(loadingMsgs[lang] || loadingMsgs.english);

      const billingHeaders: Record<string, string> = {};
      if (opts.billingApiSecret) {
        billingHeaders["x-api-secret"] = opts.billingApiSecret;
      }

      const url = `${opts.billingUrl}/balance/${telegramId}`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: billingHeaders,
      });

      if (!resp.ok) {
        await ctx.reply(errorMsgs[lang] || errorMsgs.english);
        return;
      }

      const data = (await resp.json()) as { telegramId: number; credits: number; plan: string };
      const t = creditsTranslations[lang] || creditsTranslations.english;

      let msg = `<b>${t.title}</b>\n\n`;
      msg += `${t.plan}: <b>${escapeHtml(data.plan)}</b>\n`;
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
          signal: AbortSignal.timeout(30000),
        }).catch(() => null);

        if (starterResp?.ok) {
          const { url } = (await starterResp.json()) as { url: string };
          msg += `\n<a href="${escapeHtml(url)}">Buy Starter (300 credits) - $9.80/month</a>`;
        }
      }

      await ctx.reply(msg, { parse_mode: "HTML" });
    } catch {
      await ctx.reply(errorMsgs[lang] || errorMsgs.english);
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

  // /redeem — redeem a coupon code
  const redeemTranslations: Record<string, { prompt: string; success: string; invalid: string; exhausted: string; already: string; error: string }> = {
    english: { prompt: "Enter your coupon code:", success: "Coupon redeemed! {credits} credits added. Total: {total}", invalid: "Invalid coupon code.", exhausted: "This coupon has been fully redeemed.", already: "You have already used this coupon.", error: "Could not redeem coupon. Try again later." },
    italian: { prompt: "Inserisci il codice coupon:", success: "Coupon riscattato! {credits} crediti aggiunti. Totale: {total}", invalid: "Codice coupon non valido.", exhausted: "Questo coupon è stato completamente utilizzato.", already: "Hai già utilizzato questo coupon.", error: "Impossibile riscattare il coupon. Riprova più tardi." },
    spanish: { prompt: "Ingresa tu código de cupón:", success: "Cupón canjeado! {credits} créditos añadidos. Total: {total}", invalid: "Código de cupón inválido.", exhausted: "Este cupón ya fue completamente canjeado.", already: "Ya has utilizado este cupón.", error: "No se pudo canjear el cupón. Inténtalo más tarde." },
    french: { prompt: "Entrez votre code coupon :", success: "Coupon utilisé ! {credits} crédits ajoutés. Total : {total}", invalid: "Code coupon invalide.", exhausted: "Ce coupon a été entièrement utilisé.", already: "Vous avez déjà utilisé ce coupon.", error: "Impossible d'utiliser le coupon. Réessayez plus tard." },
    german: { prompt: "Gib deinen Gutscheincode ein:", success: "Gutschein eingelöst! {credits} Credits hinzugefügt. Gesamt: {total}", invalid: "Ungültiger Gutscheincode.", exhausted: "Dieser Gutschein wurde vollständig eingelöst.", already: "Du hast diesen Gutschein bereits verwendet.", error: "Gutschein konnte nicht eingelöst werden. Versuche es später erneut." },
    portuguese: { prompt: "Insira seu código de cupom:", success: "Cupom resgatado! {credits} créditos adicionados. Total: {total}", invalid: "Código de cupom inválido.", exhausted: "Este cupom já foi totalmente utilizado.", already: "Você já utilizou este cupom.", error: "Não foi possível resgatar o cupom. Tente novamente mais tarde." },
  };

  // Track users waiting to enter a coupon code (with timestamp for TTL)
  const pendingRedeem = new Map<number, number>();
  const PENDING_REDEEM_TTL_MS = 60_000;

  bot.command("redeem", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    if (!opts.billingUrl) {
      await ctx.reply("Coupons are not available on this instance.");
      return;
    }

    const text = (ctx.message as any)?.text || "";
    const code = text.split(" ").slice(1).join("").trim().toUpperCase();
    const lang = await getUserLang(db, telegramId);
    const t = redeemTranslations[lang] || redeemTranslations.english;

    if (!code) {
      pendingRedeem.set(telegramId, Date.now());
      await ctx.reply(t.prompt);
      return;
    }

    await redeemCode(ctx, telegramId, code, lang);
  });

  // Handle text messages that might be coupon codes
  bot.on("text", async (ctx: any, next: () => Promise<void>) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return next();

    const timestamp = pendingRedeem.get(telegramId);
    if (!timestamp) return next();

    // Check TTL
    if (Date.now() - timestamp > PENDING_REDEEM_TTL_MS) {
      pendingRedeem.delete(telegramId);
      return next();
    }

    const code = ((ctx.message as any)?.text || "").trim().toUpperCase();
    if (!code || code.startsWith("/")) {
      pendingRedeem.delete(telegramId);
      return next();
    }

    pendingRedeem.delete(telegramId);
    const lang = await getUserLang(db, telegramId);
    await redeemCode(ctx, telegramId, code, lang);
  });

  async function redeemCode(ctx: Context, telegramId: number, code: string, lang: string) {
    const t = redeemTranslations[lang] || redeemTranslations.english;
    const billingHeaders: Record<string, string> = {};
    if (opts.billingApiSecret) billingHeaders["x-api-secret"] = opts.billingApiSecret;

    try {
      const resp = await fetch(`${opts.billingUrl}/coupons/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...billingHeaders },
        body: JSON.stringify({ code, telegramId }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const data = (await resp.json().catch(() => null)) as { error?: string } | null;
        const errorMap: Record<string, string> = {
          invalid_code: t.invalid,
          coupon_exhausted: t.exhausted,
          already_redeemed: t.already,
        };
        await ctx.reply(errorMap[data?.error || ""] || t.error);
        return;
      }

      const data = (await resp.json()) as { creditsAdded: number; totalCredits: number };
      await ctx.reply(
        t.success.replace("{credits}", String(data.creditsAdded)).replace("{total}", String(data.totalCredits))
      );
    } catch {
      await ctx.reply(t.error);
    }
  }
}
