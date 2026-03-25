import { eq, and } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { users, skills } from "../../db/schema.js";

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

const MAX_SKILLS = 20;
const PAGE_SIZE = 10;
const PENDING_TTL_MS = 120_000;

const translations: Record<string, Record<string, string>> = {
  english: { title: "Your Skills", empty: "You have no skills set. Add one to customize your agent's behavior!", prompt: "Reply with a number to manage that skill.", add: "+ Add Skill", addPrompt: "Send the rule you want your agent to follow:", added: "Skill added!", deleted: "Skill deleted.", toggled: "Skill toggled.", edited: "Skill updated!", maxReached: `You can have at most ${MAX_SKILLS} skills.`, invalid: "Invalid selection.", editPrompt: "Send the new text for this skill:", toggle: "Toggle ON/OFF", edit: "Edit", delete: "Delete" },
  italian: { title: "Le tue Skill", empty: "Non hai skill impostate. Aggiungine una per personalizzare il tuo agente!", prompt: "Rispondi con un numero per gestire quella skill.", add: "+ Aggiungi Skill", addPrompt: "Invia la regola che vuoi che il tuo agente segua:", added: "Skill aggiunta!", deleted: "Skill eliminata.", toggled: "Skill attivata/disattivata.", edited: "Skill aggiornata!", maxReached: `Puoi avere al massimo ${MAX_SKILLS} skill.`, invalid: "Selezione non valida.", editPrompt: "Invia il nuovo testo per questa skill:", toggle: "Attiva/Disattiva", edit: "Modifica", delete: "Elimina" },
  spanish: { title: "Tus Skills", empty: "No tienes skills configuradas. Agrega una para personalizar tu agente!", prompt: "Responde con un numero para gestionar esa skill.", add: "+ Agregar Skill", addPrompt: "Envia la regla que quieres que tu agente siga:", added: "Skill agregada!", deleted: "Skill eliminada.", toggled: "Skill activada/desactivada.", edited: "Skill actualizada!", maxReached: `Puedes tener como maximo ${MAX_SKILLS} skills.`, invalid: "Seleccion no valida.", editPrompt: "Envia el nuevo texto para esta skill:", toggle: "Activar/Desactivar", edit: "Editar", delete: "Eliminar" },
  french: { title: "Vos Skills", empty: "Vous n'avez aucune skill. Ajoutez-en une pour personnaliser votre agent !", prompt: "Repondez avec un numero pour gerer cette skill.", add: "+ Ajouter Skill", addPrompt: "Envoyez la regle que vous voulez que votre agent suive :", added: "Skill ajoutee !", deleted: "Skill supprimee.", toggled: "Skill activee/desactivee.", edited: "Skill mise a jour !", maxReached: `Vous pouvez avoir au maximum ${MAX_SKILLS} skills.`, invalid: "Selection invalide.", editPrompt: "Envoyez le nouveau texte pour cette skill :", toggle: "Activer/Desactiver", edit: "Modifier", delete: "Supprimer" },
  german: { title: "Deine Skills", empty: "Du hast keine Skills gesetzt. Fuge eine hinzu, um deinen Agenten anzupassen!", prompt: "Antworte mit einer Nummer um die Skill zu verwalten.", add: "+ Skill hinzufugen", addPrompt: "Sende die Regel, der dein Agent folgen soll:", added: "Skill hinzugefugt!", deleted: "Skill geloscht.", toggled: "Skill umgeschaltet.", edited: "Skill aktualisiert!", maxReached: `Du kannst maximal ${MAX_SKILLS} Skills haben.`, invalid: "Ungultige Auswahl.", editPrompt: "Sende den neuen Text fur diese Skill:", toggle: "Ein/Aus", edit: "Bearbeiten", delete: "Loschen" },
  portuguese: { title: "Suas Skills", empty: "Voce nao tem skills configuradas. Adicione uma para personalizar seu agente!", prompt: "Responda com um numero para gerenciar essa skill.", add: "+ Adicionar Skill", addPrompt: "Envie a regra que voce quer que seu agente siga:", added: "Skill adicionada!", deleted: "Skill deletada.", toggled: "Skill ativada/desativada.", edited: "Skill atualizada!", maxReached: `Voce pode ter no maximo ${MAX_SKILLS} skills.`, invalid: "Selecao invalida.", editPrompt: "Envie o novo texto para esta skill:", toggle: "Ativar/Desativar", edit: "Editar", delete: "Deletar" },
};

export function registerSkillsHandlers(bot: any, db: Database) {
  // Pending state maps
  const pendingSkillSelect = new Map<number, { timestamp: number; skillIds: number[] }>();
  const pendingSkillAdd = new Map<number, number>(); // telegramId -> timestamp
  const pendingSkillEdit = new Map<number, { timestamp: number; skillId: number }>();

  // Text handler for skill number selection
  bot.on("text", async (ctx: any, next: () => Promise<void>) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return next();

    // Handle skill add
    const addTs = pendingSkillAdd.get(telegramId);
    if (addTs && Date.now() - addTs < PENDING_TTL_MS) {
      const text = ((ctx.message as any)?.text || "").trim();
      if (!text || text.startsWith("/")) {
        pendingSkillAdd.delete(telegramId);
        return next();
      }
      pendingSkillAdd.delete(telegramId);

      const userId = await getUserId(db, telegramId);
      if (!userId) return;

      const lang = await getUserLang(db, telegramId);
      const t = translations[lang] || translations.english;

      // Check max limit
      const count = await db.select({ id: skills.id }).from(skills).where(eq(skills.userId, userId));
      if (count.length >= MAX_SKILLS) {
        await ctx.reply(t.maxReached);
        return;
      }

      await db.insert(skills).values({ userId, content: text });
      await ctx.reply(t.added);
      return;
    }
    if (addTs) pendingSkillAdd.delete(telegramId);

    // Handle skill edit
    const editState = pendingSkillEdit.get(telegramId);
    if (editState && Date.now() - editState.timestamp < PENDING_TTL_MS) {
      const text = ((ctx.message as any)?.text || "").trim();
      if (!text || text.startsWith("/")) {
        pendingSkillEdit.delete(telegramId);
        return next();
      }
      pendingSkillEdit.delete(telegramId);

      const lang = await getUserLang(db, telegramId);
      const t = translations[lang] || translations.english;

      await db.update(skills).set({ content: text, updatedAt: new Date() }).where(eq(skills.id, editState.skillId));
      await ctx.reply(t.edited);
      return;
    }
    if (editState) pendingSkillEdit.delete(telegramId);

    // Handle skill number selection
    const pending = pendingSkillSelect.get(telegramId);
    if (!pending) return next();

    if (Date.now() - pending.timestamp > PENDING_TTL_MS) {
      pendingSkillSelect.delete(telegramId);
      return next();
    }

    const text = ((ctx.message as any)?.text || "").trim();
    if (!text || text.startsWith("/")) {
      pendingSkillSelect.delete(telegramId);
      return next();
    }

    const num = parseInt(text, 10);
    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    if (isNaN(num) || num < 1 || num > pending.skillIds.length) {
      pendingSkillSelect.delete(telegramId);
      await ctx.reply(t.invalid);
      return;
    }

    const skillId = pending.skillIds[num - 1];
    pendingSkillSelect.delete(telegramId);

    // Show action buttons for this skill
    const skill = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (skill.length === 0) return;

    const status = skill[0].enabled ? "ON" : "OFF";
    await ctx.reply(
      `<b>#${num}</b> [${status}] ${escapeHtml(skill[0].content)}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: t.toggle, callback_data: `skill_toggle_${skillId}` },
              { text: t.edit, callback_data: `skill_edit_${skillId}` },
              { text: t.delete, callback_data: `skill_delete_${skillId}` },
            ],
          ],
        },
      }
    );
  });

  // Show skills page helper
  async function showSkillsPage(ctx: any, telegramId: number, userId: number, page: number, editMessage = false) {
    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    const allSkills = await db
      .select()
      .from(skills)
      .where(eq(skills.userId, userId))
      .orderBy(skills.createdAt);

    if (allSkills.length === 0) {
      const opts: any = {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: t.add, callback_data: "skill_add" }]],
        },
      };
      if (editMessage) {
        await ctx.editMessageText(t.empty, opts);
      } else {
        await ctx.reply(t.empty, opts);
      }
      return;
    }

    const totalPages = Math.ceil(allSkills.length / PAGE_SIZE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const start = currentPage * PAGE_SIZE;
    const pageSkills = allSkills.slice(start, start + PAGE_SIZE);

    const skillIds = allSkills.map((s) => s.id);
    pendingSkillSelect.set(telegramId, { timestamp: Date.now(), skillIds });

    let msg = `<b>${t.title}</b> (${allSkills.length})\n\n`;
    pageSkills.forEach((s, i) => {
      const globalIndex = start + i + 1;
      const status = s.enabled ? "ON" : "OFF";
      msg += `<b>${globalIndex}.</b> [${status}] ${escapeHtml(s.content)}\n`;
    });
    msg += `\nPage ${currentPage + 1}/${totalPages} — ${t.prompt}`;

    const navButtons: { text: string; callback_data: string }[] = [];
    if (currentPage > 0) {
      navButtons.push({ text: `< ${currentPage}`, callback_data: `skill_page_${currentPage - 1}` });
    }
    if (currentPage < totalPages - 1) {
      navButtons.push({ text: `${currentPage + 2} >`, callback_data: `skill_page_${currentPage + 1}` });
    }

    const keyboard: { text: string; callback_data: string }[][] = [];
    if (navButtons.length > 0) keyboard.push(navButtons);
    keyboard.push([{ text: t.add, callback_data: "skill_add" }]);

    const replyOpts: any = { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } };

    if (editMessage) {
      await ctx.editMessageText(msg, replyOpts);
    } else {
      await ctx.reply(msg, replyOpts);
    }
  }

  // /skills command
  bot.command("skills", async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const userId = await getUserId(db, telegramId);
    if (!userId) {
      await ctx.reply("Send me a message first to get started!");
      return;
    }

    await showSkillsPage(ctx, telegramId, userId, 0);
  });

  // Pagination
  bot.action(/^skill_page_(\d+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const page = parseInt(ctx.match[1], 10);
    const userId = await getUserId(db, telegramId);
    if (!userId) return;

    await ctx.answerCbQuery();
    await showSkillsPage(ctx, telegramId, userId, page, true);
  });

  // Add skill
  bot.action("skill_add", async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    // Check max limit
    const userId = await getUserId(db, telegramId);
    if (!userId) return;

    const count = await db.select({ id: skills.id }).from(skills).where(eq(skills.userId, userId));
    if (count.length >= MAX_SKILLS) {
      await ctx.answerCbQuery(t.maxReached);
      return;
    }

    pendingSkillAdd.set(telegramId, Date.now());
    await ctx.answerCbQuery();
    await ctx.reply(t.addPrompt);
  });

  // Toggle skill
  bot.action(/^skill_toggle_(\d+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const skillId = parseInt(ctx.match[1], 10);
    const skill = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (skill.length === 0) return;

    await db.update(skills).set({ enabled: !skill[0].enabled, updatedAt: new Date() }).where(eq(skills.id, skillId));

    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;
    await ctx.answerCbQuery(t.toggled);
    await ctx.editMessageText(
      `<b>[${skill[0].enabled ? "OFF" : "ON"}]</b> ${escapeHtml(skill[0].content)}`,
      { parse_mode: "HTML" }
    );
  });

  // Edit skill
  bot.action(/^skill_edit_(\d+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const skillId = parseInt(ctx.match[1], 10);
    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;

    pendingSkillEdit.set(telegramId, { timestamp: Date.now(), skillId });
    await ctx.answerCbQuery();
    await ctx.reply(t.editPrompt);
  });

  // Delete skill
  bot.action(/^skill_delete_(\d+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const skillId = parseInt(ctx.match[1], 10);
    await db.delete(skills).where(eq(skills.id, skillId));

    const lang = await getUserLang(db, telegramId);
    const t = translations[lang] || translations.english;
    await ctx.answerCbQuery(t.deleted);
    await ctx.editMessageText(t.deleted);
  });
}
