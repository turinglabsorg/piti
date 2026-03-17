import { createLogger } from "@piti/shared";

const logger = createLogger("billing");

interface BillingConfig {
  url: string;
  costs: {
    simple: number;
    complex: number;
    vision: number;
    mcp_call: number;
  };
}

interface BalanceResponse {
  telegramId: number;
  credits: number;
  plan: string;
}

interface DeductResponse {
  credits: number;
  deducted: number;
}

interface DeductErrorResponse {
  error: "insufficient_credits";
  credits: number;
  checkoutUrl?: string;
}

export class BillingClient {
  private config: BillingConfig;

  constructor(config: BillingConfig) {
    this.config = config;
  }

  /**
   * Check if user has enough credits for at least a simple message.
   * Returns the balance, or null if billing is unreachable (fail-open).
   */
  async checkBalance(telegramId: number): Promise<BalanceResponse | null> {
    try {
      const resp = await fetch(`${this.config.url}/balance/${telegramId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        logger.warn("Billing balance check failed", { status: resp.status, telegramId });
        return null; // Fail open
      }
      return (await resp.json()) as BalanceResponse;
    } catch (err) {
      logger.warn("Billing service unreachable", { error: err });
      return null; // Fail open — don't block users if billing is down
    }
  }

  /**
   * Calculate the cost of a completed request.
   */
  calculateCost(opts: {
    isComplex: boolean;
    hasVision: boolean;
    mcpCallCount: number;
  }): number {
    let cost = 0;

    if (opts.hasVision) {
      cost += this.config.costs.vision;
    } else if (opts.isComplex) {
      cost += this.config.costs.complex;
    } else {
      cost += this.config.costs.simple;
    }

    cost += opts.mcpCallCount * this.config.costs.mcp_call;

    return cost;
  }

  /**
   * Deduct credits after a successful response.
   * Returns the new balance, or null on failure (fail-open).
   */
  async deduct(
    telegramId: number,
    amount: number,
    reason: string
  ): Promise<DeductResponse | DeductErrorResponse | null> {
    try {
      const resp = await fetch(`${this.config.url}/deduct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, amount, reason }),
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        if (data?.error === "insufficient_credits") {
          return data as DeductErrorResponse;
        }
        logger.warn("Billing deduct failed", { status: resp.status, telegramId });
        return null;
      }

      const data = (await resp.json()) as DeductResponse;
      logger.info("Credits deducted", { telegramId, amount, remaining: data.credits });
      return data;
    } catch (err) {
      logger.warn("Billing deduct failed", { error: err });
      return null;
    }
  }

  /**
   * Get a Stripe checkout URL for the user.
   */
  async getCheckoutUrl(telegramId: number, plan: "starter" | "pro"): Promise<string | null> {
    try {
      const resp = await fetch(`${this.config.url}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, plan }),
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) return null;

      const data = (await resp.json()) as { url: string };
      return data.url;
    } catch (err) {
      logger.warn("Billing checkout failed", { error: err });
      return null;
    }
  }
}
