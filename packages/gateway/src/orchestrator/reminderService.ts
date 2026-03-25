import { eq, and, lte } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import type { Database } from "../db/client.js";
import { reminders, users, messages } from "../db/schema.js";
import type { Dispatcher } from "./dispatcher.js";
import { createLogger } from "@piti/shared";

const logger = createLogger("reminders");

const CHECK_INTERVAL_MS = 60_000;

export class ReminderService {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private db: Database,
    private dispatcher: Dispatcher,
    private sendTelegramMessage: (telegramId: number, text: string) => Promise<void>
  ) {}

  start() {
    this.intervalId = setInterval(() => this.checkDueReminders(), CHECK_INTERVAL_MS);
    logger.info("Reminder service started", { intervalMs: CHECK_INTERVAL_MS });
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async checkDueReminders() {
    if (this.running) return; // prevent re-entrant execution
    this.running = true;

    try {
      const now = new Date();
      const dueReminders = await this.db
        .select({
          reminder: reminders,
          user: users,
        })
        .from(reminders)
        .innerJoin(users, eq(reminders.userId, users.id))
        .where(and(
          eq(reminders.enabled, true),
          lte(reminders.nextRunAt, now)
        ));

      if (dueReminders.length === 0) return;

      logger.info("Due reminders found", { count: dueReminders.length });

      for (const { reminder, user } of dueReminders) {
        try {
          await this.fireReminder(reminder, user);
        } catch (err) {
          logger.error("Reminder fire failed", { reminderId: reminder.id, error: err });
        }
      }
    } catch (err) {
      logger.error("Reminder check failed", { error: err });
    } finally {
      this.running = false;
    }
  }

  private async fireReminder(
    reminder: typeof reminders.$inferSelect,
    user: typeof users.$inferSelect
  ) {
    // 1. Insert system message for context
    const systemContent = `[REMINDER] The user set a reminder: "${reminder.prompt}". Respond to this reminder proactively as if starting a conversation about it.`;
    await this.db.insert(messages).values({
      userId: reminder.userId,
      role: "system",
      content: systemContent,
    });

    // 2. Dispatch to agent — the reminder prompt acts as a user message
    //    isReminder=true prevents the agent from creating new reminders (infinite loop)
    const result = await this.dispatcher.dispatch(
      user.telegramId,
      reminder.prompt,
      user.username || undefined,
      user.firstName || undefined,
      undefined,
      { isReminder: true }
    );

    // 3. Send reply to Telegram
    await this.sendTelegramMessage(user.telegramId, result.reply);

    // 4. Update reminder state
    if (reminder.type === "once") {
      await this.db.update(reminders).set({
        enabled: false,
        lastRunAt: new Date(),
        nextRunAt: null,
        updatedAt: new Date(),
      }).where(eq(reminders.id, reminder.id));
    } else {
      const nextRun = computeNextRun(reminder.cronExpression!, reminder.timezone);
      await this.db.update(reminders).set({
        lastRunAt: new Date(),
        nextRunAt: nextRun,
        updatedAt: new Date(),
      }).where(eq(reminders.id, reminder.id));
    }

    logger.info("Reminder fired", {
      reminderId: reminder.id,
      userId: reminder.userId,
      type: reminder.type,
    });
  }
}

/**
 * Compute the next run time from a cron expression and timezone.
 * Returns a UTC Date.
 */
export function computeNextRun(cronExpression: string, timezone: string = "UTC"): Date {
  const expr = CronExpressionParser.parse(cronExpression, { tz: timezone });
  return expr.next().toDate();
}
