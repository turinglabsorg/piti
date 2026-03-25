import { eq, desc, sql, and } from "drizzle-orm";
import { cosineDistance, gt } from "drizzle-orm";
import { embed, embedBatch } from "../embeddings.js";
import type { Database } from "../db/client.js";
import { users, messages, memories, tokenUsage, mcpCalls, skills } from "../db/schema.js";
import { ContainerManager } from "./containerManager.js";
import type { AgentRequest, AgentResponse, ChatMessage, Memory, MediaAttachment, TokenUsage, McpCall, AgentCharacter, Skill } from "@piti/shared";
import { createLogger, SUPPORTED_LANGUAGES_SET, AGENT_CHARACTER_SET } from "@piti/shared";
import type { BillingClient } from "../billing/client.js";

const logger = createLogger("dispatcher");

const MAX_HISTORY_MESSAGES = 50;
const MAX_MEMORIES = 20;

export interface DispatchResult {
  reply: string;
  isNewUser: boolean;
  detectedLanguage?: string;
  creditsRemaining?: number;
}

export interface DispatcherDefaults {
  llmProvider: string;
  llmModel: string;
  routerModel: string;
  smartModel: string;
  language: string;
}

export class Dispatcher {
  private billing: BillingClient | null = null;

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

  setBilling(billing: BillingClient) {
    this.billing = billing;
  }

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
    const userMemories = await this.getMemories(user.id, messageText);

    // 4b. Load user skills
    const userSkills = await this.getSkills(user.id);

    // 5. Build agent request
    const request: AgentRequest = {
      userId: user.id,
      telegramId,
      message: messageText,
      conversationHistory: history,
      memories: userMemories,
      skills: userSkills,
      userProfile: (user.profile as Record<string, unknown>) || {},
      llmProvider: user.llmProvider,
      llmModel: user.llmModel,
      routerModel: this.defaults.routerModel,
      smartModel: this.defaults.smartModel,
      language: detectedLanguage || user.language,
      media,
    };

    // 6. Check billing (if enabled)
    if (this.billing) {
      const balance = await this.billing.checkBalance(telegramId);
      if (!balance) {
        logger.warn("Billing unreachable, allowing request (fail-open)", { telegramId });
      }
      if (balance && balance.credits <= 0) {
        const checkoutUrl = await this.billing.getCheckoutUrl(telegramId, "starter");
        const buyMsg = checkoutUrl
          ? `\n\nPer continuare ad usare PITI, acquista dei crediti: ${checkoutUrl}`
          : "";
        return {
          reply: `Hai esaurito i crediti gratuiti.${buyMsg}`,
          isNewUser: isNew,
        };
      }
    }

    // 7. Get or create container and send message
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

    // 10. Save MCP call logs
    if (response.mcpCalls?.length) {
      await this.saveMcpCalls(user.id, response.mcpCalls);
    }

    // 11. Deduct billing credits (if enabled)
    let creditsRemaining: number | undefined;
    if (this.billing) {
      const hasVision = !!media;
      const isComplex = response.tokenUsage?.some(
        (t) => t.model === this.defaults.smartModel && t.purpose === "chat"
      ) ?? false;
      const mcpCallCount = response.mcpCalls?.length ?? 0;

      const cost = this.billing.calculateCost({ isComplex, hasVision, mcpCallCount });
      const reason = [
        hasVision ? "vision" : isComplex ? "complex" : "simple",
        mcpCallCount > 0 ? `+${mcpCallCount}mcp` : "",
      ].filter(Boolean).join("_");

      const deductResult = await this.billing.deduct(telegramId, cost, reason);
      if (deductResult && "credits" in deductResult && !("error" in deductResult)) {
        creditsRemaining = deductResult.credits;
      }
    }

    return {
      reply: response.reply,
      isNewUser: isNew,
      detectedLanguage: isNew ? detectedLanguage : undefined,
      creditsRemaining,
    };
  }

  async getUserLanguage(telegramId: number): Promise<string> {
    const row = await this.db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    return row.length > 0 ? row[0].language : "english";
  }

  async setUserLanguage(telegramId: number, language: string) {
    if (!SUPPORTED_LANGUAGES_SET.has(language)) {
      logger.warn("Rejected invalid language", { telegramId, language });
      return;
    }
    await this.db
      .update(users)
      .set({ language })
      .where(eq(users.telegramId, telegramId));
    logger.info("User language updated", { telegramId, language });
  }

  async setUserAgentName(telegramId: number, name: string): Promise<boolean> {
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) return false;

    const existing = await this.db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (existing.length === 0) return false;

    const profile = (existing[0].profile as Record<string, unknown>) || {};
    profile.agentName = trimmed;

    await this.db.update(users).set({ profile }).where(eq(users.telegramId, telegramId));
    logger.info("User agent name updated", { telegramId, agentName: trimmed });
    return true;
  }

  async setUserCharacter(telegramId: number, character: string): Promise<boolean> {
    if (!AGENT_CHARACTER_SET.has(character)) {
      logger.warn("Rejected invalid character", { telegramId, character });
      return false;
    }

    const existing = await this.db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (existing.length === 0) return false;

    const profile = (existing[0].profile as Record<string, unknown>) || {};
    profile.agentCharacter = character;

    await this.db.update(users).set({ profile }).where(eq(users.telegramId, telegramId));
    logger.info("User agent character updated", { telegramId, character });
    return true;
  }

  /**
   * Insert a system message into all active users' conversation history.
   * Used for daily date-change notifications so the agent knows the current date.
   */
  async broadcastSystemMessage(content: string): Promise<number> {
    const allUsers = await this.db.select({ id: users.id }).from(users);
    if (allUsers.length === 0) return 0;

    await this.db.insert(messages).values(
      allUsers.map((u) => ({
        userId: u.id,
        role: "system",
        content,
      }))
    );

    logger.info("System message broadcast", { userCount: allUsers.length, content: content.slice(0, 100) });
    return allUsers.length;
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

  private async getMemories(userId: number, userMessage?: string): Promise<Memory[]> {
    // Try semantic search if we have a user message to match against
    if (userMessage) {
      const queryEmbedding = await embed(userMessage);
      if (queryEmbedding) {
        const similarity = sql<number>`1 - (${cosineDistance(memories.embedding, queryEmbedding)})`;
        const rows = await this.db
          .select({
            id: memories.id,
            userId: memories.userId,
            content: memories.content,
            category: memories.category,
            createdAt: memories.createdAt,
            updatedAt: memories.updatedAt,
            similarity,
          })
          .from(memories)
          .where(and(
            eq(memories.userId, userId),
            gt(similarity, 0.3) // minimum relevance threshold
          ))
          .orderBy(sql`${similarity} DESC`)
          .limit(MAX_MEMORIES);

        if (rows.length > 0) {
          logger.info("Semantic memory retrieval", { userId, count: rows.length, topSimilarity: rows[0].similarity });
          return rows.map((r) => ({
            id: r.id,
            userId: r.userId,
            content: r.content,
            category: r.category as Memory["category"],
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }));
        }
      }
    }

    // Fallback: recency-based retrieval (for messages without embeddings or when embedding fails)
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

  private async getSkills(userId: number): Promise<Skill[]> {
    const rows = await this.db
      .select()
      .from(skills)
      .where(and(eq(skills.userId, userId), eq(skills.enabled, true)));

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      enabled: r.enabled,
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

    // Generate embeddings for new memories
    const embeddings = await embedBatch(newMemories.map((m) => m.content));

    // Semantic deduplication: check each new memory against existing ones
    const unique: { content: string; category: string; embedding: number[] | null }[] = [];

    for (let i = 0; i < newMemories.length; i++) {
      const m = newMemories[i];
      const emb = embeddings[i];

      // Try semantic dedup if we have an embedding
      if (emb) {
        const similarity = sql<number>`1 - (${cosineDistance(memories.embedding, emb)})`;
        const similar = await this.db
          .select({ id: memories.id, content: memories.content, similarity })
          .from(memories)
          .where(and(
            eq(memories.userId, userId),
            gt(similarity, 0.85) // high threshold = very similar
          ))
          .orderBy(sql`${similarity} DESC`)
          .limit(1);

        if (similar.length > 0) {
          // Update existing memory instead of creating duplicate
          await this.db.update(memories).set({
            content: m.content,
            category: m.category,
            embedding: emb,
            updatedAt: new Date(),
          }).where(eq(memories.id, similar[0].id));
          logger.info("Memory updated (semantic dedup)", { userId, oldContent: similar[0].content.slice(0, 50), newContent: m.content.slice(0, 50), similarity: similar[0].similarity });
          continue;
        }
      } else {
        // Fallback: string dedup
        const existing = await this.db
          .select({ content: memories.content })
          .from(memories)
          .where(eq(memories.userId, userId));
        const existingSet = new Set(existing.map((e) => e.content.toLowerCase().trim()));
        if (existingSet.has(m.content.toLowerCase().trim())) continue;
      }

      unique.push({ ...m, embedding: emb });
    }

    if (unique.length === 0) {
      logger.info("No new unique memories to save", { userId });
      return;
    }

    await this.db.insert(memories).values(
      unique.map((m) => ({
        userId,
        content: m.content,
        category: m.category,
        embedding: m.embedding,
      }))
    );

    logger.info("Memories saved", { userId, count: unique.length, withEmbeddings: unique.filter(m => m.embedding).length });
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

  private async saveMcpCalls(userId: number, calls: McpCall[]) {
    if (calls.length === 0) return;

    await this.db.insert(mcpCalls).values(
      calls.map((c) => ({
        userId,
        server: c.server,
        tool: c.tool,
        args: c.args,
        durationMs: c.durationMs,
      }))
    );

    logger.info("MCP calls saved", {
      userId,
      count: calls.length,
      tools: calls.map((c) => `${c.server}/${c.tool}`),
    });
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
