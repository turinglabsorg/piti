import { eq, desc, and, gte, lt } from "drizzle-orm";
import { embed } from "../embeddings.js";
import type { Database } from "../db/client.js";
import { users, messages, memories } from "../db/schema.js";
import { createLogger } from "@piti/shared";

const logger = createLogger("recap");

const DELAY_BETWEEN_USERS_MS = 2000;
const MAX_CONTENT_LENGTH = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateDDMMYYYY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateDDMM(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function formatMonthYear(date: Date): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

export class RecapService {
  private apiKey: string;
  private model: string;

  constructor(
    private db: Database,
    apiKey: string,
    model: string = "google/gemini-2.5-flash"
  ) {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Generate daily recaps for all users who had messages today.
   */
  async runDailyRecaps(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find users who had messages today
    const usersWithMessages = await this.db
      .selectDistinct({ userId: messages.userId })
      .from(messages)
      .where(
        and(
          gte(messages.createdAt, today),
          lt(messages.createdAt, tomorrow)
        )
      );

    if (usersWithMessages.length === 0) {
      logger.info("No users with messages today, skipping daily recaps");
      return 0;
    }

    let count = 0;
    for (const { userId } of usersWithMessages) {
      try {
        await this.generateDailyRecap(userId, today, tomorrow);
        count++;
      } catch (err) {
        logger.error("Failed to generate daily recap", { userId, error: err });
      }
      await sleep(DELAY_BETWEEN_USERS_MS);
    }

    logger.info("Daily recaps completed", { usersProcessed: count });
    return count;
  }

  /**
   * Generate weekly recaps (run on Mondays) by summarizing daily recaps from the past 7 days.
   */
  async runWeeklyRecaps(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Find users who have daily recaps in the past week
    const dailyRecaps = await this.db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.category, "recap"),
          gte(memories.createdAt, weekAgo),
          lt(memories.createdAt, today)
        )
      );

    // Group by user
    const byUser = new Map<number, string[]>();
    for (const recap of dailyRecaps) {
      if (!recap.content.startsWith("[Daily recap")) continue;
      const list = byUser.get(recap.userId) || [];
      list.push(recap.content);
      byUser.set(recap.userId, list);
    }

    if (byUser.size === 0) {
      logger.info("No daily recaps found for weekly summary");
      return 0;
    }

    let count = 0;
    const weekStart = formatDateDDMM(weekAgo);
    const weekEnd = formatDateDDMM(new Date(today.getTime() - 86400000)); // yesterday

    for (const [userId, recaps] of byUser) {
      try {
        const combined = recaps.join("\n").slice(0, MAX_CONTENT_LENGTH);
        const summary = await this.callLlm(
          `Summarize these daily fitness coaching recaps into 2-3 sentences highlighting key themes, progress, and patterns:\n\n${combined}`
        );

        if (summary) {
          const content = `[Weekly recap - ${weekStart} to ${weekEnd}]: ${summary}`;
          const embedding = await embed(content);

          await this.db.insert(memories).values({
            userId,
            content,
            category: "recap",
            embedding,
          });

          logger.info("Weekly recap generated", { userId, content: content.slice(0, 100) });
          count++;
        }
      } catch (err) {
        logger.error("Failed to generate weekly recap", { userId, error: err });
      }
      await sleep(DELAY_BETWEEN_USERS_MS);
    }

    logger.info("Weekly recaps completed", { usersProcessed: count });
    return count;
  }

  /**
   * Generate monthly recaps (run on the 1st) by summarizing weekly recaps from the past month.
   */
  async runMonthlyRecaps(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    // Get the previous month for labeling
    const prevMonth = new Date(today);
    prevMonth.setMonth(prevMonth.getMonth() - 1);

    // Find weekly recaps from the past month
    const weeklyRecaps = await this.db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.category, "recap"),
          gte(memories.createdAt, monthAgo),
          lt(memories.createdAt, today)
        )
      );

    // Group by user
    const byUser = new Map<number, string[]>();
    for (const recap of weeklyRecaps) {
      if (!recap.content.startsWith("[Weekly recap")) continue;
      const list = byUser.get(recap.userId) || [];
      list.push(recap.content);
      byUser.set(recap.userId, list);
    }

    if (byUser.size === 0) {
      logger.info("No weekly recaps found for monthly summary");
      return 0;
    }

    let count = 0;
    const monthLabel = formatMonthYear(prevMonth);

    for (const [userId, recaps] of byUser) {
      try {
        const combined = recaps.join("\n").slice(0, MAX_CONTENT_LENGTH);
        const summary = await this.callLlm(
          `Summarize these weekly fitness coaching recaps into a concise monthly overview (2-3 sentences) highlighting overall progress, achievements, and areas of focus:\n\n${combined}`
        );

        if (summary) {
          const content = `[Monthly recap - ${monthLabel}]: ${summary}`;
          const embedding = await embed(content);

          await this.db.insert(memories).values({
            userId,
            content,
            category: "recap",
            embedding,
          });

          logger.info("Monthly recap generated", { userId, content: content.slice(0, 100) });
          count++;
        }
      } catch (err) {
        logger.error("Failed to generate monthly recap", { userId, error: err });
      }
      await sleep(DELAY_BETWEEN_USERS_MS);
    }

    logger.info("Monthly recaps completed", { usersProcessed: count });
    return count;
  }

  private async generateDailyRecap(
    userId: number,
    dayStart: Date,
    dayEnd: Date
  ): Promise<void> {
    // Fetch user+assistant messages for this day
    const dayMessages = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          gte(messages.createdAt, dayStart),
          lt(messages.createdAt, dayEnd)
        )
      )
      .orderBy(messages.createdAt)
      .limit(50);

    // Filter to user and assistant roles only
    const relevantMessages = dayMessages.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    if (relevantMessages.length === 0) return;

    // Build conversation text, capping content
    const conversationText = relevantMessages
      .map((m) => `${m.role}: ${m.content.slice(0, MAX_CONTENT_LENGTH)}`)
      .join("\n")
      .slice(0, MAX_CONTENT_LENGTH);

    const summary = await this.callLlm(
      `Summarize this fitness coaching conversation in 1-2 sentences, focusing on what the user discussed, any advice given, and key topics:\n\n${conversationText}`
    );

    if (!summary) return;

    const dateStr = formatDateDDMMYYYY(dayStart);
    const content = `[Daily recap - ${dateStr}]: ${summary}`;
    const embedding = await embed(content);

    await this.db.insert(memories).values({
      userId,
      content,
      category: "recap",
      embedding,
    });

    logger.info("Daily recap generated", { userId, date: dateStr, content: content.slice(0, 100) });
  }

  private async callLlm(prompt: string): Promise<string | null> {
    if (!this.apiKey) {
      logger.warn("No API key configured for recap LLM calls");
      return null;
    }

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "You are a concise summarizer. Produce brief, factual summaries without preamble.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 200,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        logger.warn("Recap LLM call failed", { status: response.status });
        return null;
      }

      const data = (await response.json()) as {
        choices: { message: { content: string } }[];
      };

      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch (err) {
      logger.error("Recap LLM call error", { error: err });
      return null;
    }
  }
}
