# Billing Integration Guide

PITI includes a built-in billing client that connects to an external billing service via HTTP. The commercial billing backend (in `piti-platform/billing/`) is closed source, but the integration contract is simple and well-defined — you can implement your own billing service in any language or framework.

This guide explains the API contract your billing service must implement to work with PITI.

## Opting Out

If you don't need billing, simply leave it disabled in `config.yaml`:

```yaml
billing:
  enabled: false
```

When disabled, all billing checks are skipped — the agent runs with no credit limits and no usage restrictions. This is the recommended setup for self-hosted or development deployments.

## How It Works

The gateway's `BillingClient` (`packages/gateway/src/billing/client.ts`) makes HTTP calls to your billing service at two key points in the request lifecycle:

1. **Before processing** — checks if the user has enough credits (`GET /balance/:telegramId`)
2. **After processing** — deducts credits based on what happened (`POST /deduct`)

The client is **fail-open by design**: if the billing service is unreachable, users are not blocked. Monitor logs for `failOpen: true` entries to detect issues.

## Configuration

Enable billing in `config.yaml`:

```yaml
billing:
  enabled: true
  url: "https://your-billing-service.example.com"
  api_secret: "shared-secret-between-piti-and-billing"
  costs:
    simple: 1       # Cheap model message (e.g., Flash)
    complex: 3      # Smart model message (e.g., Pro)
    vision: 5       # Photo/video analysis
    mcp_call: 1     # Per MCP tool call (additive)
```

When `billing.enabled` is `false` (default), the gateway skips all billing checks and the agent runs without credit limits.

## Required API Endpoints

Your billing service must implement the following endpoints. All protected endpoints receive an `x-api-secret` header for authentication.

### `GET /balance/:telegramId`

Returns the user's current credit balance. Should auto-create the user with free credits if they don't exist yet.

**Headers:** `x-api-secret: <shared secret>`

**Response (200):**
```json
{
  "telegramId": 123456789,
  "credits": 42,
  "plan": "free"
}
```

### `POST /deduct`

Deducts credits after a successful agent response.

**Headers:** `x-api-secret: <shared secret>`, `Content-Type: application/json`

**Request body:**
```json
{
  "telegramId": 123456789,
  "amount": 3,
  "reason": "complex chat message"
}
```

**Response (200):**
```json
{
  "credits": 39,
  "deducted": 3
}
```

**Response (402 — insufficient credits):**
```json
{
  "error": "insufficient_credits",
  "credits": 0,
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

The `checkoutUrl` field is optional. If provided, the gateway will include a payment link in the user's insufficient-credits message.

### `POST /checkout` (optional)

Creates a payment/checkout session for the user.

**Request body:**
```json
{
  "telegramId": 123456789,
  "plan": "starter"
}
```

**Response (200):**
```json
{
  "url": "https://checkout.stripe.com/cs_live_..."
}
```

### Referral endpoints (optional)

If you want referral support, implement these:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/referral/apply-signup` | POST | `{ referredTelegramId, referralCode }` → apply signup bonus |
| `/referral/code/:telegramId` | GET | Returns `{ referralCode }` |
| `/referral/stats/:telegramId` | GET | Returns `{ referralCode, referralCount, referralCreditsEarned }` |

## Cost Calculation

The `BillingClient` calculates costs automatically based on the request:

| Condition | Cost |
|-----------|------|
| Simple message (cheap model) | `costs.simple` |
| Complex message (smart model) | `costs.complex` |
| Vision (photo/video) | `costs.vision` |
| Each MCP tool call | `+ costs.mcp_call` |

Vision and complex are mutually exclusive (vision takes priority). MCP costs are additive on top.

## Example: Minimal Billing Service

Here's a minimal billing service in Node.js that uses an in-memory store. Use this as a starting point — in production, replace with a real database.

```typescript
import Fastify from "fastify";

const app = Fastify();
const FREE_CREDITS = 20;
const API_SECRET = process.env.API_SECRET || "your-secret";

// In-memory store — replace with a real database
const users = new Map<number, { credits: number; plan: string }>();

function getOrCreateUser(telegramId: number) {
  if (!users.has(telegramId)) {
    users.set(telegramId, { credits: FREE_CREDITS, plan: "free" });
  }
  return users.get(telegramId)!;
}

// Auth middleware
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  if (req.headers["x-api-secret"] !== API_SECRET) {
    reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async () => ({ status: "ok" }));

app.get("/balance/:telegramId", async (req) => {
  const telegramId = Number((req.params as any).telegramId);
  const user = getOrCreateUser(telegramId);
  return { telegramId, credits: user.credits, plan: user.plan };
});

app.post("/deduct", async (req, reply) => {
  const { telegramId, amount, reason } = req.body as any;
  const user = getOrCreateUser(telegramId);

  if (user.credits < amount) {
    reply.code(402).send({
      error: "insufficient_credits",
      credits: user.credits,
    });
    return;
  }

  user.credits -= amount;
  return { credits: user.credits, deducted: amount };
});

app.listen({ port: 3001 }, () => {
  console.log("Billing service running on :3001");
});
```

Then in `config.yaml`:

```yaml
billing:
  enabled: true
  url: "http://localhost:3001"
  api_secret: "your-secret"
  costs:
    simple: 1
    complex: 3
    vision: 5
    mcp_call: 1
```

## Using a Different Payment Provider

The billing contract is payment-agnostic. The only Stripe-specific part is `checkoutUrl` in the insufficient-credits response, which is optional. You can integrate any payment provider (Stripe, Paddle, LemonSqueezy, crypto, etc.) — PITI only cares about the credit balance and deduction endpoints.
