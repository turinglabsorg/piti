import { eq } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import type { Database } from "../../db/client.js";
import { users, reminders } from "../../db/schema.js";
import { computeNextRun } from "../../orchestrator/reminderService.js";

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

async function getUserId(db: Database, telegramId: number): Promise<number | null> {
  const row = await db.select({ id: users.id }).from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return row.length > 0 ? row[0].id : null;
}

const MAX_REMINDERS = 20;
const PAGE_SIZE = 10;
const PENDING_TTL_MS = 120_000;

const translations: Record<string, Record<string, string>> = {
  english: {
    title: "Your Reminders", empty: "You have no reminders. Add one to get proactive messages from your agent!",
    prompt: "Reply with a number to manage that reminder.", add: "+ Add Reminder",
    promptAsk: "What should your agent do? Send the prompt:",
    freqAsk: "How often?",
    timeAsk: "What time? Send HH:MM (24h format):",
    dayAsk: "Which day?",
    dateAsk: "When? Pick a preset or send DD/MM/YYYY:",
    added: "Reminder created!", deleted: "Reminder deleted.", toggled: "Reminder toggled.",
    edited: "Reminder updated!", maxReached: `You can have at most ${MAX_REMINDERS} reminders.`,
    invalid: "Invalid selection.", invalidTime: "Invalid time format. Use HH:MM (e.g., 08:00).",
    invalidDate: "Invalid date. Use DD/MM/YYYY.", editPrompt: "Send the new prompt for this reminder:",
    toggle: "Toggle", edit: "Edit", delete: "Delete",
    once: "Once", daily: "Daily", weekly: "Weekly", weekdays: "Weekdays",
    today: "Today", tomorrow: "Tomorrow",
    mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
  },
  italian: {
    title: "I tuoi Promemoria", empty: "Non hai promemoria. Aggiungine uno per ricevere messaggi proattivi dal tuo agente!",
    prompt: "Rispondi con un numero per gestire quel promemoria.", add: "+ Aggiungi Promemoria",
    promptAsk: "Cosa deve fare il tuo agente? Invia il prompt:",
    freqAsk: "Con che frequenza?",
    timeAsk: "A che ora? Invia HH:MM (formato 24h):",
    dayAsk: "Quale giorno?",
    dateAsk: "Quando? Scegli un'opzione o invia GG/MM/AAAA:",
    added: "Promemoria creato!", deleted: "Promemoria eliminato.", toggled: "Promemoria attivato/disattivato.",
    edited: "Promemoria aggiornato!", maxReached: `Puoi avere al massimo ${MAX_REMINDERS} promemoria.`,
    invalid: "Selezione non valida.", invalidTime: "Formato ora non valido. Usa HH:MM (es. 08:00).",
    invalidDate: "Data non valida. Usa GG/MM/AAAA.", editPrompt: "Invia il nuovo prompt per questo promemoria:",
    toggle: "Attiva/Disattiva", edit: "Modifica", delete: "Elimina",
    once: "Una volta", daily: "Giornaliero", weekly: "Settimanale", weekdays: "Giorni feriali",
    today: "Oggi", tomorrow: "Domani",
    mon: "Lun", tue: "Mar", wed: "Mer", thu: "Gio", fri: "Ven", sat: "Sab", sun: "Dom",
  },
  spanish: {
    title: "Tus Recordatorios", empty: "No tienes recordatorios. Agrega uno para recibir mensajes proactivos de tu agente!",
    prompt: "Responde con un numero para gestionar ese recordatorio.", add: "+ Agregar Recordatorio",
    promptAsk: "Que debe hacer tu agente? Envia el prompt:",
    freqAsk: "Con que frecuencia?",
    timeAsk: "A que hora? Envia HH:MM (formato 24h):",
    dayAsk: "Que dia?",
    dateAsk: "Cuando? Elige una opcion o envia DD/MM/AAAA:",
    added: "Recordatorio creado!", deleted: "Recordatorio eliminado.", toggled: "Recordatorio activado/desactivado.",
    edited: "Recordatorio actualizado!", maxReached: `Puedes tener como maximo ${MAX_REMINDERS} recordatorios.`,
    invalid: "Seleccion no valida.", invalidTime: "Formato de hora no valido. Usa HH:MM (ej. 08:00).",
    invalidDate: "Fecha no valida. Usa DD/MM/AAAA.", editPrompt: "Envia el nuevo prompt para este recordatorio:",
    toggle: "Activar/Desactivar", edit: "Editar", delete: "Eliminar",
    once: "Una vez", daily: "Diario", weekly: "Semanal", weekdays: "Dias laborables",
    today: "Hoy", tomorrow: "Manana",
    mon: "Lun", tue: "Mar", wed: "Mie", thu: "Jue", fri: "Vie", sat: "Sab", sun: "Dom",
  },
  french: {
    title: "Vos Rappels", empty: "Vous n'avez aucun rappel. Ajoutez-en un pour recevoir des messages proactifs de votre agent !",
    prompt: "Repondez avec un numero pour gerer ce rappel.", add: "+ Ajouter Rappel",
    promptAsk: "Que doit faire votre agent ? Envoyez le prompt :",
    freqAsk: "A quelle frequence ?",
    timeAsk: "A quelle heure ? Envoyez HH:MM (format 24h) :",
    dayAsk: "Quel jour ?",
    dateAsk: "Quand ? Choisissez une option ou envoyez JJ/MM/AAAA :",
    added: "Rappel cree !", deleted: "Rappel supprime.", toggled: "Rappel active/desactive.",
    edited: "Rappel mis a jour !", maxReached: `Vous pouvez avoir au maximum ${MAX_REMINDERS} rappels.`,
    invalid: "Selection invalide.", invalidTime: "Format d'heure invalide. Utilisez HH:MM (ex. 08:00).",
    invalidDate: "Date invalide. Utilisez JJ/MM/AAAA.", editPrompt: "Envoyez le nouveau prompt pour ce rappel :",
    toggle: "Activer/Desactiver", edit: "Modifier", delete: "Supprimer",
    once: "Une fois", daily: "Quotidien", weekly: "Hebdomadaire", weekdays: "Jours ouvrables",
    today: "Aujourd'hui", tomorrow: "Demain",
    mon: "Lun", tue: "Mar", wed: "Mer", thu: "Jeu", fri: "Ven", sat: "Sam", sun: "Dim",
  },
  german: {
    title: "Deine Erinnerungen", empty: "Du hast keine Erinnerungen. Fuge eine hinzu, um proaktive Nachrichten von deinem Agenten zu erhalten!",
    prompt: "Antworte mit einer Nummer um die Erinnerung zu verwalten.", add: "+ Erinnerung hinzufugen",
    promptAsk: "Was soll dein Agent tun? Sende den Prompt:",
    freqAsk: "Wie oft?",
    timeAsk: "Um welche Uhrzeit? Sende HH:MM (24h Format):",
    dayAsk: "Welcher Tag?",
    dateAsk: "Wann? Wahle eine Option oder sende TT/MM/JJJJ:",
    added: "Erinnerung erstellt!", deleted: "Erinnerung geloscht.", toggled: "Erinnerung umgeschaltet.",
    edited: "Erinnerung aktualisiert!", maxReached: `Du kannst maximal ${MAX_REMINDERS} Erinnerungen haben.`,
    invalid: "Ungultige Auswahl.", invalidTime: "Ungultiges Zeitformat. Nutze HH:MM (z.B. 08:00).",
    invalidDate: "Ungultiges Datum. Nutze TT/MM/JJJJ.", editPrompt: "Sende den neuen Prompt fur diese Erinnerung:",
    toggle: "Ein/Aus", edit: "Bearbeiten", delete: "Loschen",
    once: "Einmalig", daily: "Taglich", weekly: "Wochentlich", weekdays: "Werktags",
    today: "Heute", tomorrow: "Morgen",
    mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So",
  },
  portuguese: {
    title: "Seus Lembretes", empty: "Voce nao tem lembretes. Adicione um para receber mensagens proativas do seu agente!",
    prompt: "Responda com um numero para gerenciar esse lembrete.", add: "+ Adicionar Lembrete",
    promptAsk: "O que seu agente deve fazer? Envie o prompt:",
    freqAsk: "Com que frequencia?",
    timeAsk: "Que horas? Envie HH:MM (formato 24h):",
    dayAsk: "Qual dia?",
    dateAsk: "Quando? Escolha uma opcao ou envie DD/MM/AAAA:",
    added: "Lembrete criado!", deleted: "Lembrete deletado.", toggled: "Lembrete ativado/desativado.",
    edited: "Lembrete atualizado!", maxReached: `Voce pode ter no maximo ${MAX_REMINDERS} lembretes.`,
    invalid: "Selecao invalida.", invalidTime: "Formato de hora invalido. Use HH:MM (ex. 08:00).",
    invalidDate: "Data invalida. Use DD/MM/AAAA.", editPrompt: "Envie o novo prompt para este lembrete:",
    toggle: "Ativar/Desativar", edit: "Editar", delete: "Deletar",
    once: "Uma vez", daily: "Diario", weekly: "Semanal", weekdays: "Dias uteis",
    today: "Hoje", tomorrow: "Amanha",
    mon: "Seg", tue: "Ter", wed: "Qua", thu: "Qui", fri: "Sex", sat: "Sab", sun: "Dom",
  },
};

interface ReminderFlowState {
  step: "prompt" | "time" | "day" | "date";
  timestamp: number;
  prompt?: string;
  frequency?: "once" | "daily" | "weekly" | "weekdays";
  dayOfWeek?: number;
  timezone: string;
}

export function registerRemindersHandlers(bot: any, db: Database) {
  const pendingSelect = new Map<number, { timestamp: number; reminderIds: number[] }>();
  const pendingFlow = new Map<number, ReminderFlowState>();
  const pendingEdit = new Map<number, { timestamp: number; reminderId: number }>();

  // Text handler for reminder flows
  bot.on("text", async (ctx: any, next: () => Promise<void>) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return next();

    const text = ((ctx.message as any)?.text || "").trim();
    if (!text || text.startsWith("/")) {
      pendingFlow.delete(telegramId);
      pendingSelect.delete(telegramId);
      pendingEdit.delete(telegramId);
      return next();
    }

    // Handle edit
    const editState = pendingEdit.get(telegramId);
    if (editState && Date.now() - editState.timestamp < PENDING_TTL_MS) {
      pendingEdit.delete(telegramId);
      const lang = await getUserLang(db, telegramId);
      const t = translations[lang] || translations.english;
      await db.update(reminders).set({ prompt: text, updatedAt: new Date() }).where(eq(reminders.id, editState.reminderId));
      await ctx.reply(t.edited);
      return;
    }
    if (editState) pendingEdit.delete(telegramId);

    // Handle creation flow
    const flow = pendingFlow.get(telegramId);
    if (flow && Date.now() - flow.timestamp < PENDING_TTL_MS) {
      const lang = await getUserLang(db, telegramId);
      const t = translations[lang] || translations.english;

      if (flow.step === "prompt") {
        flow.prompt = text;
        flow.timestamp = Date.now();
        flow.step = "time"; // will be set after frequency is chosen, but we need freq first
        pendingFlow.set(telegramId, { ...flow, step: "prompt" }); // keep in prompt state until freq callback
        // Show frequency picker
        await ctx.reply(t.freqAsk, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: t.once, callback_data: "remind_freq_once" },
                { text: t.daily, callback_data: "remind_freq_daily" },
              ],
              [
                { text: t.weekly, callback_data: "remind_freq_weekly" },
                { text: t.weekdays, callback_data: "remind_freq_weekdays" },
              ],
            ],
          },
        });
        return;
      }

      if (flow.step === "time") {
        const timeMatch = text.match(/^(\d{1,2}):?(\d{2})?$/);
        if (!timeMatch) {
          await ctx.reply(t.invalidTime);
          return;
        }
        const hour = parseInt(timeMatch[1], 10);
        const minute = parseInt(timeMatch[2] || "0", 10);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
          await ctx.reply(t.invalidTime);
          return;
        }

        const userId = await getUserId(db, telegramId);
        if (!userId) return;

        if (flow.frequency === "once") {
          // Ask for date
          pendingFlow.set(telegramId, { ...flow, step: "date", timestamp: Date.now() });
          // Store hour/minute temporarily in the flow object
          (flow as any).hour = hour;
          (flow as any).minute = minute;
          pendingFlow.set(telegramId, { ...flow, step: "date", timestamp: Date.now() });
          await ctx.reply(t.dateAsk, {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: t.today, callback_data: `remind_date_today_${hour}_${minute}` },
                  { text: t.tomorrow, callback_data: `remind_date_tomorrow_${hour}_${minute}` },
                ],
              ],
            },
          });
          return;
        }

        // Build cron expression for recurring reminders
        let cronExpression: string;
        if (flow.frequency === "daily") {
          cronExpression = `${minute} ${hour} * * *`;
        } else if (flow.frequency === "weekdays") {
          cronExpression = `${minute} ${hour} * * 1-5`;
        } else if (flow.frequency === "weekly") {
          cronExpression = `${minute} ${hour} * * ${flow.dayOfWeek ?? 1}`;
        } else {
          return;
        }

        const nextRun = computeNextRun(cronExpression, flow.timezone);
        await db.insert(reminders).values({
          userId,
          prompt: flow.prompt!,
          type: "recurring",
          cronExpression,
          timezone: flow.timezone,
          nextRunAt: nextRun,
        });

        pendingFlow.delete(telegramId);
        await ctx.reply(t.added);
        return;
      }

      if (flow.step === "date") {
        // Parse DD/MM/YYYY
        const dateMatch = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
        if (!dateMatch) {
          await ctx.reply(t.invalidDate);
          return;
        }

        const day = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1;
        const year = parseInt(dateMatch[3], 10);
        const hour = (flow as any).hour || 0;
        const minute = (flow as any).minute || 0;

        const scheduledAt = new Date(year, month, day, hour, minute, 0);
        if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
          await ctx.reply(t.invalidDate);
          return;
        }

        const userId = await getUserId(db, telegramId);
        if (!userId) return;

        await db.insert(reminders).values({
          userId,
          prompt: flow.prompt!,
          type: "once",
          scheduledAt,
          timezone: flow.timezone,
          nextRunAt: scheduledAt,
        });

        pendingFlow.delete(telegramId);
        await ctx.reply(t.added);
        return;
      }
    }
    if (flow) pendingFlow.delete(telegramId);

    // Handle number selection
    const pending = pendingSelect.get(telegramId);
    if (!pending) return next();

    if (Date.now() - pending.timestamp > PENDING_TTL_MS) {
      pendingSelect.delete(telegramId);
      return next();
    }

    const num = parseInt(text, 10);
    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    if (isNaN(num) || num < 1 || num > pending.reminderIds.length) {
      pendingSelect.delete(telegramId);
      await ctx.reply(t.invalid);
      return;
    }

    const reminderId = pending.reminderIds[num - 1];
    pendingSelect.delete(telegramId);

    const reminder = await db.select().from(reminders).where(eq(reminders.id, reminderId)).limit(1);
    if (reminder.length === 0) return;

    const r = reminder[0];
    const status = r.enabled ? "ON" : (r.type === "once" && !r.enabled ? "DONE" : "OFF");
    const schedule = formatSchedule(r, t);

    await ctx.reply(
      `<b>#${num}</b> [${status}] ${schedule}\n"${escapeHtml(r.prompt)}"`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: t.toggle, callback_data: `remind_toggle_${reminderId}` },
              { text: t.edit, callback_data: `remind_edit_${reminderId}` },
              { text: t.delete, callback_data: `remind_delete_${reminderId}` },
            ],
          ],
        },
      }
    );
  });

  // Show reminders page
  async function showRemindersPage(ctx: any, telegramId: number, userId: number, page: number, editMessage = false) {
    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    const allReminders = await db
      .select()
      .from(reminders)
      .where(eq(reminders.userId, userId))
      .orderBy(reminders.createdAt);

    if (allReminders.length === 0) {
      const opts: any = {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: t.add, callback_data: "remind_add" }]],
        },
      };
      if (editMessage) {
        await ctx.editMessageText(t.empty, opts);
      } else {
        await ctx.reply(t.empty, opts);
      }
      return;
    }

    const totalPages = Math.ceil(allReminders.length / PAGE_SIZE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const start = currentPage * PAGE_SIZE;
    const pageReminders = allReminders.slice(start, start + PAGE_SIZE);

    const reminderIds = allReminders.map((r) => r.id);
    pendingSelect.set(telegramId, { timestamp: Date.now(), reminderIds });

    let msg = `<b>${t.title}</b> (${allReminders.length})\n\n`;
    pageReminders.forEach((r, i) => {
      const globalIndex = start + i + 1;
      const status = r.enabled ? "ON" : (r.type === "once" && !r.enabled ? "DONE" : "OFF");
      const schedule = formatSchedule(r, t);
      msg += `<b>${globalIndex}.</b> [${status}] ${schedule} — "${escapeHtml(r.prompt.slice(0, 50))}${r.prompt.length > 50 ? "..." : ""}"\n`;
    });
    msg += `\nPage ${currentPage + 1}/${totalPages} — ${t.prompt}`;

    const navButtons: { text: string; callback_data: string }[] = [];
    if (currentPage > 0) {
      navButtons.push({ text: `< ${currentPage}`, callback_data: `remind_page_${currentPage - 1}` });
    }
    if (currentPage < totalPages - 1) {
      navButtons.push({ text: `${currentPage + 2} >`, callback_data: `remind_page_${currentPage + 1}` });
    }

    const keyboard: { text: string; callback_data: string }[][] = [];
    if (navButtons.length > 0) keyboard.push(navButtons);
    keyboard.push([{ text: t.add, callback_data: "remind_add" }]);

    const replyOpts: any = { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } };

    if (editMessage) {
      await ctx.editMessageText(msg, replyOpts);
    } else {
      await ctx.reply(msg, replyOpts);
    }
  }

  // /reminders command
  bot.command("reminders", async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const userId = await getUserId(db, telegramId);
    if (!userId) {
      await ctx.reply("Send me a message first to get started!");
      return;
    }

    await showRemindersPage(ctx, telegramId, userId, 0);
  });

  // Pagination
  bot.action(/^remind_page_(\d+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const page = parseInt(ctx.match[1], 10);
    const userId = await getUserId(db, telegramId);
    if (!userId) return;

    await ctx.answerCbQuery();
    await showRemindersPage(ctx, telegramId, userId, page, true);
  });

  // Add reminder — start flow
  bot.action("remind_add", async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    const userId = await getUserId(db, telegramId);
    if (!userId) return;

    const count = await db.select({ id: reminders.id }).from(reminders).where(eq(reminders.userId, userId));
    if (count.length >= MAX_REMINDERS) {
      await ctx.answerCbQuery(t.maxReached);
      return;
    }

    pendingFlow.set(telegramId, { step: "prompt", timestamp: Date.now(), timezone: "UTC" });
    await ctx.answerCbQuery();
    await ctx.reply(t.promptAsk);
  });

  // Frequency selection
  bot.action(/^remind_freq_(once|daily|weekly|weekdays)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const frequency = ctx.match[1] as "once" | "daily" | "weekly" | "weekdays";
    const flow = pendingFlow.get(telegramId);
    if (!flow || !flow.prompt) return;

    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    await ctx.answerCbQuery();

    if (frequency === "weekly") {
      // Ask for day of week first
      pendingFlow.set(telegramId, { ...flow, frequency, step: "day", timestamp: Date.now() });
      await ctx.editMessageText(t.dayAsk, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: t.mon, callback_data: "remind_day_1" },
              { text: t.tue, callback_data: "remind_day_2" },
              { text: t.wed, callback_data: "remind_day_3" },
              { text: t.thu, callback_data: "remind_day_4" },
            ],
            [
              { text: t.fri, callback_data: "remind_day_5" },
              { text: t.sat, callback_data: "remind_day_6" },
              { text: t.sun, callback_data: "remind_day_0" },
            ],
          ],
        },
      });
      return;
    }

    // For once, daily, weekdays — ask for time
    pendingFlow.set(telegramId, { ...flow, frequency, step: "time", timestamp: Date.now() });
    await ctx.editMessageText(t.timeAsk);
  });

  // Day of week selection (for weekly)
  bot.action(/^remind_day_(\d)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const dayOfWeek = parseInt(ctx.match[1], 10);
    const flow = pendingFlow.get(telegramId);
    if (!flow) return;

    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    pendingFlow.set(telegramId, { ...flow, dayOfWeek, step: "time", timestamp: Date.now() });
    await ctx.answerCbQuery();
    await ctx.editMessageText(t.timeAsk);
  });

  // Date presets for one-shot reminders
  bot.action(/^remind_date_(today|tomorrow)_(\d+)_(\d+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const preset = ctx.match[1] as "today" | "tomorrow";
    const hour = parseInt(ctx.match[2], 10);
    const minute = parseInt(ctx.match[3], 10);

    const flow = pendingFlow.get(telegramId);
    if (!flow || !flow.prompt) return;

    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    const now = new Date();
    const scheduledAt = new Date(now);
    if (preset === "tomorrow") {
      scheduledAt.setDate(scheduledAt.getDate() + 1);
    }
    scheduledAt.setHours(hour, minute, 0, 0);

    // If today but time already passed, reject
    if (scheduledAt <= now) {
      pendingFlow.delete(telegramId);
      await ctx.answerCbQuery(t.invalidDate);
      return;
    }

    const userId = await getUserId(db, telegramId);
    if (!userId) return;

    await db.insert(reminders).values({
      userId,
      prompt: flow.prompt,
      type: "once",
      scheduledAt,
      timezone: flow.timezone,
      nextRunAt: scheduledAt,
    });

    pendingFlow.delete(telegramId);
    await ctx.answerCbQuery();
    await ctx.editMessageText(t.added);
  });

  // Toggle reminder
  bot.action(/^remind_toggle_(\d+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const reminderId = parseInt(ctx.match[1], 10);
    const reminder = await db.select().from(reminders).where(eq(reminders.id, reminderId)).limit(1);
    if (reminder.length === 0) return;

    const r = reminder[0];
    const newEnabled = !r.enabled;

    // If re-enabling a recurring reminder, recompute nextRunAt
    let nextRunAt = r.nextRunAt;
    if (newEnabled && r.type === "recurring" && r.cronExpression) {
      nextRunAt = computeNextRun(r.cronExpression, r.timezone);
    }

    await db.update(reminders).set({ enabled: newEnabled, nextRunAt, updatedAt: new Date() }).where(eq(reminders.id, reminderId));

    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;
    await ctx.answerCbQuery(t.toggled);
    await ctx.editMessageText(
      `<b>[${newEnabled ? "ON" : "OFF"}]</b> "${escapeHtml(r.prompt.slice(0, 80))}"`,
      { parse_mode: "HTML" }
    );
  });

  // Edit reminder prompt
  bot.action(/^remind_edit_(\d+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const reminderId = parseInt(ctx.match[1], 10);
    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    pendingEdit.set(telegramId, { timestamp: Date.now(), reminderId });
    await ctx.answerCbQuery();
    await ctx.reply(t.editPrompt);
  });

  // Delete reminder
  bot.action(/^remind_delete_(\d+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const reminderId = parseInt(ctx.match[1], 10);
    await db.delete(reminders).where(eq(reminders.id, reminderId));

    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;
    await ctx.answerCbQuery(t.deleted);
    await ctx.editMessageText(t.deleted);
  });
}

/** Format a reminder's schedule for display */
function formatSchedule(r: typeof reminders.$inferSelect, t: Record<string, string>): string {
  if (r.type === "once" && r.scheduledAt) {
    const d = r.scheduledAt;
    return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  if (r.cronExpression) {
    try {
      const parts = r.cronExpression.split(" ");
      const minute = parts[0].padStart(2, "0");
      const hour = parts[1].padStart(2, "0");
      const dow = parts[4];

      if (dow === "*") return `${t.daily} ${hour}:${minute}`;
      if (dow === "1-5") return `${t.weekdays} ${hour}:${minute}`;

      const dayNames: Record<string, string> = {
        "0": t.sun, "1": t.mon, "2": t.tue, "3": t.wed,
        "4": t.thu, "5": t.fri, "6": t.sat,
      };
      const dayLabel = dayNames[dow] || dow;
      return `${t.weekly} ${dayLabel} ${hour}:${minute}`;
    } catch {
      return r.cronExpression;
    }
  }

  return "?";
}
