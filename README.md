# PITI - Personal AI Trainer

PITI is an autonomous personal trainer agent powered by LLMs. It connects to users via Telegram and provides personalized guidance on workouts, nutrition, and health.

Each user gets their own isolated Docker container running a dedicated LLM session with persistent long-term memory stored in PostgreSQL.

## Architecture

```
Telegram → Gateway (Telegraf) → Container Manager (Dockerode) → Agent Container (Fastify + AI SDK)
                ↕                        ↕                              ↕
           PostgreSQL              Redis (registry)              LLM Provider
         (users, messages,       (container tracking)        (Kimi / Claude / OpenRouter)
          memories + pgvector)
```

**Three packages (pnpm monorepo):**

- `packages/shared` — Types, env validation, logger
- `packages/gateway` — Telegram bot, container orchestration, database
- `packages/agent` — LLM agent, system prompt, topic guard, memory extraction

## Features

- **Per-user Docker containers** — Each user gets an isolated agent container, auto-created on first message, destroyed after 1h idle
- **Long-term memory** — Agent extracts facts from conversations (goals, injuries, PRs, preferences) and stores them in PostgreSQL with pgvector for semantic search
- **Multi-LLM support** — Kimi (Code Plan), Claude (Anthropic), OpenRouter — switchable per user via `/provider`
- **Multi-language** — Auto-detects user language on first message, configurable per user via `/language`
- **Topic enforcement** — Two-layer guard (keyword heuristic + LLM classifier) ensures the agent only discusses fitness, nutrition, and health
- **Access control** — Optional `TELEGRAM_ALLOWED_USERS` env var to restrict the bot to specific Telegram users

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm
- Docker

### 1. Clone and install

```bash
git clone https://github.com/turinglabs/piti.git
cd piti
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

Required:
- `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.me/BotFather)
- At least one LLM provider key (`KIMI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`)

### 3. Start infrastructure

```bash
docker compose up -d postgres redis
```

### 4. Build the agent image

```bash
pnpm build:agent-image
```

### 5. Start the gateway

```bash
pnpm dev:gateway
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/profile` | View your fitness profile |
| `/provider` | Switch LLM provider (kimi/claude/openrouter) |
| `/language` | Set response language |
| `/memories` | View what PITI remembers about you |
| `/reset` | Clear conversation history (memories preserved) |
| `/help` | Show available commands |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram bot token |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | — | Redis connection string |
| `KIMI_API_KEY` | No | — | Kimi Code Plan API key |
| `ANTHROPIC_API_KEY` | No | — | Anthropic API key |
| `OPENROUTER_API_KEY` | No | — | OpenRouter API key |
| `DEFAULT_LLM_PROVIDER` | No | `claude` | Default LLM for new users |
| `DEFAULT_LLM_MODEL` | No | `claude-sonnet-4-20250514` | Default model |
| `DEFAULT_LANGUAGE` | No | `english` | Default response language |
| `TELEGRAM_ALLOWED_USERS` | No | _(empty = open)_ | Comma-separated Telegram user IDs |
| `CONTAINER_IDLE_TIMEOUT_MS` | No | `3600000` | Container idle timeout (1h) |
| `AGENT_IMAGE` | No | `piti-agent` | Docker image for agent containers |
| `AGENT_PORT_RANGE_START` | No | `4000` | Port range start |
| `AGENT_PORT_RANGE_END` | No | `4100` | Port range end |

## Development

```bash
# Run tests
pnpm test

# Dev mode (auto-reload)
pnpm dev:gateway

# Build all packages
pnpm build
```

## Production

```bash
docker compose up -d
```

This starts the gateway, PostgreSQL, and Redis. Agent containers are spawned on-demand by the gateway via the Docker socket.

## License

MIT
