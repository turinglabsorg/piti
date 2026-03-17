import { eq, desc, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { users, messages, memories, tokenUsage } from "../db/schema.js";
import { ContainerManager } from "./containerManager.js";
import type { AgentRequest, AgentResponse, ChatMessage, Memory, MediaAttachment, TokenUsage } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("dispatcher");

const MAX_HISTORY_MESSAGES = 50;
const MAX_MEMORIES = 10;

export interface DispatchResult {
  reply: string;
  isNewUser: boolean;
  detectedLanguage?: string;
}

export interface DispatcherDefaults {
  llmProvider: string;
  llmModel: string;
  routerModel: string;
  smartModel: string;
  language: string;
}

export class Dispatcher {
  constructor(
    private db: Database,
    private containerManager: ContainerManager,
    private envVars: Record<string, string>,
    private defaults: DispatcherDefaults = {
      llmProvider: "claude",
      llmModel: "claude-sonnet-4-20250514",
      routerModel: "google/gemini-2.5-flash",
      smartModel: "google/gemini-2.5-pro",
      language: "english",
    }
  ) {}

  async dispatch(
    telegramId: number,
    messageText: string,
    username?: string,
    firstName?: string,
    media?: MediaAttachment
  ): Promise<DispatchResult> {
    // 1. Get or create user
    const { user, isNew } = await this.getOrCreateUser(telegramId, username, firstName);

    // 2. If new user, detect language from their first message
    let detectedLanguage: string | undefined;
    if (isNew) {
      detectedLanguage = detectLanguage(messageText);
      if (detectedLanguage && detectedLanguage !== user.language) {
        // Temporarily use the detected language for this request
        // but don't save it yet — we'll ask the user to confirm
      }
    }

    // 3. Load conversation history
    const history = await this.getConversationHistory(user.id);

    // 4. Load relevant memories
    const userMemories = await this.getMemories(user.id);

    // 5. Build agent request
    const request: AgentRequest = {
      userId: user.id,
      telegramId,
      message: messageText,
      conversationHistory: history,
      memories: userMemories,
      userProfile: (user.profile as Record<string, unknown>) || {},
      llmProvider: user.llmProvider,
      llmModel: user.llmModel,
      routerModel: this.defaults.routerModel,
      smartModel: this.defaults.smartModel,
      language: detectedLanguage || user.language,
      media,
    };

    // 6. Get or create container and send message
    await this.containerManager.getOrCreateContainer(user.id, this.envVars);
    const response = await this.containerManager.sendMessage(user.id, request);

    // 7. Save messages to DB
    await this.saveMessages(user.id, messageText, response.reply);

    // 8. Save any new memories extracted by the agent
    if (response.newMemories?.length) {
      await this.saveMemories(user.id, response.newMemories);
    }

    // 9. Save token usage
    if (response.tokenUsage?.length) {
      await this.saveTokenUsage(user.id, response.tokenUsage);
    }

    return {
      reply: response.reply,
      isNewUser: isNew,
      detectedLanguage: isNew ? detectedLanguage : undefined,
    };
  }

  async setUserLanguage(telegramId: number, language: string) {
    await this.db
      .update(users)
      .set({ language })
      .where(eq(users.telegramId, telegramId));
    logger.info("User language updated", { telegramId, language });
  }

  private async getOrCreateUser(
    telegramId: number,
    username?: string,
    firstName?: string
  ): Promise<{ user: typeof users.$inferSelect; isNew: boolean }> {
    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (existing.length > 0) {
      return { user: existing[0], isNew: false };
    }

    const [newUser] = await this.db
      .insert(users)
      .values({
        telegramId,
        username: username || null,
        firstName: firstName || null,
        llmProvider: this.defaults.llmProvider,
        llmModel: this.defaults.llmModel,
        language: this.defaults.language,
      })
      .returning();

    logger.info("New user created", { telegramId, userId: newUser.id });
    return { user: newUser, isNew: true };
  }

  private async getConversationHistory(userId: number): Promise<ChatMessage[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(MAX_HISTORY_MESSAGES);

    return rows.reverse().map((r) => ({
      id: r.id,
      userId: r.userId,
      role: r.role as ChatMessage["role"],
      content: r.content,
      createdAt: r.createdAt,
    }));
  }

  private async getMemories(userId: number): Promise<Memory[]> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(desc(memories.updatedAt))
      .limit(MAX_MEMORIES);

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      content: r.content,
      category: r.category as Memory["category"],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  private async saveMessages(
    userId: number,
    userMessage: string,
    assistantReply: string
  ) {
    await this.db.insert(messages).values([
      { userId, role: "user", content: userMessage },
      { userId, role: "assistant", content: assistantReply },
    ]);
  }

  private async saveMemories(
    userId: number,
    newMemories: { content: string; category: string }[]
  ) {
    if (newMemories.length === 0) return;

    await this.db.insert(memories).values(
      newMemories.map((m) => ({
        userId,
        content: m.content,
        category: m.category,
      }))
    );

    logger.info("Memories saved", { userId, count: newMemories.length });
  }

  private async saveTokenUsage(
    userId: number,
    usage: TokenUsage[]
  ) {
    if (usage.length === 0) return;

    await this.db.insert(tokenUsage).values(
      usage.map((u) => ({
        userId,
        provider: u.provider,
        model: u.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        purpose: u.purpose,
      }))
    );

    const totalIn = usage.reduce((s, u) => s + u.inputTokens, 0);
    const totalOut = usage.reduce((s, u) => s + u.outputTokens, 0);
    logger.info("Token usage saved", { userId, calls: usage.length, totalIn, totalOut });
  }
}

/**
 * Simple language detection based on Unicode ranges and common words.
 * Returns the detected language name or undefined if unsure.
 */
function detectLanguage(text: string): string | undefined {
  const lower = text.toLowerCase().trim();

  // Common word patterns per language
  const patterns: [RegExp, string][] = [
    // Italian - common words/articles
    [/\b(ciao|buongiorno|come stai|vorrei|sono|allenamento|palestra|mangiare|esercizio|muscoli)\b/, "italian"],
    // French
    [/\b(bonjour|salut|comment|je suis|voudrais|entraînement|musculation|manger|exercice)\b/, "french"],
    // Spanish
    [/\b(hola|buenos días|cómo estás|quiero|soy|entrenamiento|gimnasio|comer|ejercicio|músculos)\b/, "spanish"],
    // German
    [/\b(hallo|guten tag|wie geht|ich bin|training|fitnessstudio|essen|übung|muskeln)\b/, "german"],
    // Portuguese
    [/\b(olá|bom dia|como vai|eu sou|treino|academia|comer|exercício|músculos)\b/, "portuguese"],
    // Chinese characters
    [/[\u4e00-\u9fff]/, "chinese"],
    // Japanese (hiragana/katakana)
    [/[\u3040-\u30ff]/, "japanese"],
    // Korean
    [/[\uac00-\ud7af]/, "korean"],
    // Russian/Cyrillic
    [/[\u0400-\u04ff]/, "russian"],
    // Arabic
    [/[\u0600-\u06ff]/, "arabic"],
  ];

  for (const [pattern, language] of patterns) {
    if (pattern.test(lower)) {
      return language;
    }
  }

  // Default: if it looks like plain ASCII, assume English
  if (/^[\x00-\x7f\s]+$/.test(text)) {
    return "english";
  }

  return undefined;
}
