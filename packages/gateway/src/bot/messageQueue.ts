import { createHash } from "crypto";
import { createLogger } from "@piti/shared";

const logger = createLogger("message-queue");

/**
 * Per-user message queue that serializes message processing.
 * Ensures consecutive messages are handled one at a time,
 * each seeing the full conversation context from previous messages.
 */
export class MessageQueue {
  /** Per-user promise chain — each message waits for the previous to complete */
  private queues = new Map<number, Promise<void>>();

  /** Track processed Telegram message IDs to avoid reprocessing */
  private processedMessageIds = new Map<number, Set<number>>();
  private readonly MAX_TRACKED_IDS = 100;

  /** Track recent reply hashes per user to avoid duplicate outgoing messages */
  private recentReplies = new Map<number, { hash: string; ts: number }[]>();
  private readonly DEDUP_WINDOW_MS = 60_000; // 1 minute
  private readonly MAX_RECENT_REPLIES = 10;

  /**
   * Enqueue a message for processing. Returns a promise that resolves
   * when this message has been fully processed (including reply sent).
   */
  enqueue(telegramId: number, messageId: number, handler: () => Promise<void>): Promise<void> {
    // Check if this message was already processed (Telegram retry)
    if (this.wasProcessed(telegramId, messageId)) {
      logger.warn("Dropping duplicate incoming message", { telegramId, messageId });
      return Promise.resolve();
    }
    this.markProcessed(telegramId, messageId);

    // Chain onto the existing queue for this user
    const prev = this.queues.get(telegramId) ?? Promise.resolve();
    const next = prev.then(async () => {
      try {
        await handler();
      } catch (err) {
        logger.error("Queued message handler error", { telegramId, messageId, error: err });
      }
    });

    this.queues.set(telegramId, next);

    // Cleanup: remove the queue entry once it settles (avoid memory leak)
    next.finally(() => {
      if (this.queues.get(telegramId) === next) {
        this.queues.delete(telegramId);
      }
    });

    return next;
  }

  /**
   * Check if an outgoing reply is a duplicate of a recently sent message.
   * Returns true if the reply should be suppressed.
   */
  isDuplicateReply(telegramId: number, reply: string): boolean {
    const hash = createHash("sha256").update(reply).digest("hex").slice(0, 16);
    const now = Date.now();

    const recent = this.recentReplies.get(telegramId) ?? [];
    // Prune expired entries
    const valid = recent.filter((r) => now - r.ts < this.DEDUP_WINDOW_MS);

    if (valid.some((r) => r.hash === hash)) {
      logger.warn("Suppressing duplicate outgoing reply", { telegramId, hash });
      return true;
    }

    // Track this reply
    valid.push({ hash, ts: now });
    if (valid.length > this.MAX_RECENT_REPLIES) {
      valid.shift();
    }
    this.recentReplies.set(telegramId, valid);

    return false;
  }

  private wasProcessed(telegramId: number, messageId: number): boolean {
    return this.processedMessageIds.get(telegramId)?.has(messageId) ?? false;
  }

  private markProcessed(telegramId: number, messageId: number): void {
    let ids = this.processedMessageIds.get(telegramId);
    if (!ids) {
      ids = new Set();
      this.processedMessageIds.set(telegramId, ids);
    }
    ids.add(messageId);

    // Evict oldest if too many (keep memory bounded)
    if (ids.size > this.MAX_TRACKED_IDS) {
      const first = ids.values().next().value;
      if (first !== undefined) ids.delete(first);
    }
  }
}
