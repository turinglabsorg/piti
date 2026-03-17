# HTTP API Reference

PITI includes a local HTTP API as an alternative interface to Telegram. It is useful for testing, debugging, building custom frontends, or integrating PITI into other applications.

## Overview

The API is served by the gateway process alongside the Telegram bot. It goes through the same pipeline: user lookup, container orchestration, agent dispatch, memory extraction, and token tracking.

The API is disabled by default. Enable it in `config.yaml`:

```yaml
api:
  enabled: true
  port: 3000
  user_map:
    local: 0
```

## User Mapping

The API does not have its own authentication system. Instead, it uses a `user_map` to associate API user keys with Telegram user IDs. This means an API user and a Telegram user can share the same conversation history, memories, and token usage.

```yaml
api:
  user_map:
    local: 123456789    # "local" API user maps to Telegram user ID 123456789
    dev: 987654321      # "dev" API user maps to a different Telegram account
```

When calling API endpoints, pass the `user` field to select which mapped user to act as. If omitted, it defaults to `"local"`.

Setting a user map value to `0` creates a standalone API user that is not linked to any Telegram account.

## Endpoints

### `GET /health`

Health check. Returns the API status and configured user keys.

**Request:**

```bash
curl http://localhost:3000/health
```

**Response:**

```json
{
  "status": "ok",
  "users": ["local"]
}
```

---

### `POST /chat`

Send a message and receive the AI response. This is the main endpoint -- it triggers the full agent pipeline including container creation, model routing, MCP tool usage, memory extraction, and token tracking.

**Request:**

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the best exercises for lower back pain?"}'
```

**Body parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `message` | string | Yes | -- | The user message to send to the agent |
| `user` | string | No | `"local"` | Key from `api.user_map` in config.yaml |

**Response:**

```json
{
  "reply": "For lower back pain, I recommend starting with these gentle exercises...",
  "isNewUser": false,
  "detectedLanguage": null
}
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `reply` | string | The agent's response text (markdown formatted) |
| `isNewUser` | boolean | `true` if this was the user's first message ever |
| `detectedLanguage` | string or null | Language detected from the user's first message (only on first interaction) |

**Error responses:**

- `400` -- Missing `message` field
- `500` -- Agent or container error (check gateway logs)

**Example with a specific user:**

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me my workout plan", "user": "dev"}'
```

---

### `GET /status`

List all registered users in the system.

**Request:**

```bash
curl http://localhost:3000/status
```

**Response:**

```json
{
  "users": [
    {
      "id": 1,
      "telegramId": 123456789,
      "username": "john",
      "language": "english",
      "provider": "openrouter"
    },
    {
      "id": 2,
      "telegramId": 987654321,
      "username": "dev",
      "language": "italian",
      "provider": "openrouter"
    }
  ]
}
```

---

### `GET /status/:user`

Get detailed status for a specific mapped user, including token usage statistics, MCP call stats, and stored memories.

**Request:**

```bash
curl http://localhost:3000/status/local
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `user` | Key from `api.user_map` in config.yaml |

**Response:**

```json
{
  "user": {
    "id": 1,
    "username": "local",
    "language": "italian",
    "provider": "openrouter",
    "model": "google/gemini-2.5-flash"
  },
  "tokenUsage": [
    {
      "model": "google/gemini-2.5-flash",
      "totalIn": 45230,
      "totalOut": 12840,
      "calls": 28
    },
    {
      "model": "google/gemini-2.5-pro",
      "totalIn": 18500,
      "totalOut": 8200,
      "calls": 5
    }
  ],
  "mcpUsage": [
    {
      "server": "search",
      "tool": "search",
      "calls": 12,
      "avgMs": 850
    },
    {
      "server": "search",
      "tool": "fetch_content",
      "calls": 4,
      "avgMs": 1200
    }
  ],
  "memories": [
    {
      "category": "goal",
      "content": "Wants to run a half marathon in under 2 hours"
    },
    {
      "category": "injury",
      "content": "Had a right knee ACL tear 3 years ago, fully recovered"
    },
    {
      "category": "routine",
      "content": "Trains 4 days per week: Mon/Wed upper body, Tue/Thu lower body"
    },
    {
      "category": "nutrition",
      "content": "Lactose intolerant, uses plant-based protein powder"
    }
  ]
}
```

**Error responses:**

- `404` -- User not found (the mapped Telegram user ID has never interacted with the bot)
- `500` -- Database or internal error

## Notes

- The API shares the same Docker container pool as Telegram. Sending a message via the API will create an agent container for that user if one does not already exist.
- Messages sent via the API are stored in the same `messages` table as Telegram messages. Switching between the API and Telegram is seamless if the user map points to the same Telegram ID.
- The API does not support media attachments (photos/videos). Use Telegram for vision features.
- CORS is enabled by default, allowing requests from any origin. This makes it suitable for local development with web frontends.
- Response times depend on container startup (cold start ~5-10s), model routing, and LLM generation. Expect 2-30 seconds depending on query complexity.
