# PITI -- Personal Intelligent Tailored Interactions

PITI is a generic, multi-tenant AI agent platform that runs on Telegram. It provides the full infrastructure for deploying autonomous AI agents with persistent memory, multi-language support, vision capabilities, and extensible tool use — all out of the box. The first agent built on PITI is a fitness coach, but the platform is designed to power any domain-specific AI assistant.

Each user gets an isolated Docker container running their own AI agent instance, with conversation history, long-term memories, and token usage tracked independently in PostgreSQL.

## Key Features

- **Multi-user isolation** -- Each user gets a dedicated Docker container, auto-created on first message, auto-destroyed after idle timeout
- **Two-tier model routing** -- A cheap router model (e.g., Gemini Flash) classifies messages as simple/complex/off-topic, then routes to the appropriate model. Complex queries and media go to a smart model (e.g., Gemini Pro)
- **Vision capabilities** -- Send photos and videos for analysis. Videos are processed with ffmpeg frame extraction for multi-frame understanding
- **MCP integration** -- Extensible tool system via Model Context Protocol. Ships with DuckDuckGo web search; add new tools with 3 lines of config
- **Long-term memory** -- Automatically extracts and stores facts about each user (goals, preferences, context) across conversations using RAG with pgvector embeddings
- **Token usage tracking** -- Per-user, per-model tracking of input/output tokens for chat, classification, and memory extraction
- **MCP call tracking** -- Every tool call logged with timing, arguments, and server info
- **Multi-language support** -- Auto-detects user language on first message, supports 11+ languages with per-language system messages
- **Configurable topic guard** -- Two-layer guard system (regex heuristics + LLM classification) keeps the agent on-topic for your domain
- **Local HTTP API** -- REST API for testing and building alternative frontends, with user mapping to share data with Telegram accounts
- **Domain-agnostic core** -- System prompt, guard rules, and memory categories are configurable — swap the personality and domain without changing the platform

## Architecture

```
                                    ┌─────────────────────────────────┐
                                    │             Server              │
                                    │                                 │
  ┌──────────┐   Telegram API       │  ┌───────────────────────────┐  │
  │ Telegram │ <──────────────────> │  │    Gateway (Node.js)      │  │
  └──────────┘                      │  │                           │  │
                                    │  │  - Telegram bot (telegraf) │  │
  ┌──────────┐   HTTP :3000         │  │  - HTTP API (fastify)     │  │
  │ HTTP API │ <──────────────────> │  │  - Container orchestrator │  │
  │ clients  │                      │  │  - User/memory DB access  │  │
  └──────────┘                      │  └─────────┬─────────────────┘  │
                                    │            │ creates per-user   │
                                    │            v                    │
                                    │  ┌───────────────────────────┐  │
                                    │  │  Agent Container (Docker)  │  │
                                    │  │  - One per active user     │  │
                                    │  │  - Fastify HTTP server     │  │
                                    │  │  - Calls LLM providers     │  │
                                    │  │  - Uses MCP tools via HTTP │  │
                                    │  └─────────┬─────────────────┘  │
                                    │            │ HTTP :5100         │
                                    │            v                    │
                                    │  ┌───────────────────────────┐  │
                                    │  │  MCP Bridge (Python)       │  │
                                    │  │  - FastAPI HTTP server     │  │
                                    │  │  - Spawns MCP servers      │  │
                                    │  │  - stdio --> DuckDuckGo    │  │
                                    │  │  - stdio --> (extensible)  │  │
                                    │  └───────────────────────────┘  │
                                    │                                 │
                                    │  ┌─────────────┐ ┌───────────┐ │
                                    │  │ PostgreSQL   │ │   Redis   │ │
                                    │  │ (pgvector)   │ │ (state)   │ │
                                    │  └─────────────┘ └───────────┘ │
                                    └─────────────────────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Gateway | Node.js, TypeScript, Telegraf, Fastify |
| Agent | Node.js, TypeScript, Vercel AI SDK, Fastify |
| MCP Bridge | Python, FastAPI, MCP SDK |
| Database | PostgreSQL 16 with pgvector |
| State/Registry | Redis 7 |
| Containers | Docker (dockerode) |
| LLM Providers | OpenRouter, Anthropic, Kimi |
| Process Manager | PM2 |
| Package Manager | pnpm (monorepo workspaces) |
| Testing | Vitest |

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (with Docker Compose)
- ffmpeg (for video frame extraction)

### 1. Clone and install

```bash
git clone <repo-url> piti
cd piti
pnpm install
```

### 2. Configure

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml` and fill in:
- `telegram.token` -- Your Telegram bot token from [@BotFather](https://t.me/BotFather)
- `telegram.allowed_users` -- Array of Telegram user IDs allowed to use the bot (empty = allow all)
- `llm.providers.openrouter.api_key` -- Your [OpenRouter](https://openrouter.ai/) API key (or configure another provider)

### 3. Start infrastructure

```bash
docker compose up -d postgres redis
```

This starts PostgreSQL (port 5433) and Redis (port 6379).

### 4. Initialize the database

```bash
docker exec -i piti-postgres-1 psql -U piti -d piti < scripts/init-db.sql
```

### 5. Build the shared package

```bash
pnpm --filter @piti/shared build
```

### 6. Build the agent Docker image

```bash
docker build -t piti-agent -f packages/agent/Dockerfile .
```

### 7. Build the MCP bridge image

```bash
docker compose build mcp-bridge
```

### 8. Start the gateway

```bash
# Using PM2 (recommended)
pnpm pm2 start ecosystem.config.cjs

# Or directly for development
pnpm dev:gateway
```

### 9. Verify

Send `/status` to your Telegram bot. You should see your user info, provider settings, and MCP service status.

## Configuration Reference

The `config.yaml` file controls all aspects of the system.

### `telegram`

```yaml
telegram:
  token: "YOUR_TELEGRAM_BOT_TOKEN"  # Bot token from @BotFather
  allowed_users: []                  # Telegram user IDs; empty = allow everyone
```

### `database`

```yaml
database:
  url: "postgresql://piti:piti_secret@localhost:5433/piti"
  agent_url: "postgresql://piti:piti_secret@host.docker.internal:5433/piti"
```

Two connection strings are needed because the gateway runs on the host while agent containers run inside Docker. The `agent_url` uses `host.docker.internal` to reach PostgreSQL from within a container.

### `redis`

```yaml
redis:
  url: "redis://localhost:6379"
```

Redis is used for container registry (tracking which user has which container/port) and port allocation.

### `docker`

```yaml
docker:
  agent_image: "piti-agent"       # Docker image name for agent containers
  port_range: [4000, 4100]        # Port pool for agent containers (max 100 concurrent users)
  idle_timeout_ms: 3600000        # Destroy idle containers after 1 hour (ms)
```

### `llm`

```yaml
llm:
  default_provider: "openrouter"            # Provider for new users
  default_model: "google/gemini-2.5-flash"  # Default chat model
  router_model: "google/gemini-2.5-flash"   # Cheap model for classification + memory extraction
  smart_model: "google/gemini-2.5-pro"      # Expensive model for complex queries + media
  default_language: "italian"               # Default response language for new users
  providers:
    openrouter:
      api_key: "YOUR_OPENROUTER_API_KEY"
    anthropic:
      api_key: ""
    kimi:
      api_key: ""
```

**Supported providers and models:**

| Provider | Models |
|----------|--------|
| openrouter | `google/gemini-2.5-flash`, `google/gemini-2.5-pro`, `anthropic/claude-sonnet-4-20250514`, `openai/gpt-4o` |
| claude | `claude-sonnet-4-20250514`, `claude-haiku-4-5-20251001` |
| kimi | `kimi-for-coding`, `kimi-k2-thinking-turbo` |

**How routing works:** Every incoming message is first classified by the `router_model` (cheap, fast) into one of three categories:
- **SIMPLE** -- Handled by the `router_model` itself (greetings, basic questions, simple facts)
- **COMPLEX** -- Escalated to the `smart_model` (detailed plans, in-depth advice, multi-step reasoning)
- **OFF-TOPIC** -- Rejected with a localized refusal message

Messages with media (photos/videos) always use the `smart_model`.

### `api`

```yaml
api:
  enabled: true    # Enable the local HTTP API
  port: 3000       # API port
  user_map:
    local: 0       # Map "local" API user to a Telegram user ID
```

The `user_map` connects API user keys to Telegram user IDs so they share conversation history and memories. Set the value to your actual Telegram user ID to link them. See [docs/api.md](docs/api.md) for full API documentation.

### `mcp`

```yaml
mcp:
  search:
    enabled: true
    package: "duckduckgo-mcp-server"
    command: ["python", "-m", "duckduckgo_mcp_server.server"]
```

Each MCP server entry has:
- `enabled` -- Toggle without removing config
- `package` -- pip package name, installed dynamically at bridge startup
- `command` -- How to spawn the MCP server process (stdio transport)

See [docs/mcp.md](docs/mcp.md) for detailed MCP documentation, including how to add new servers.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and feature overview |
| `/help` | List all available commands |
| `/profile` | View your user profile (built from conversation) |
| `/provider <name> [model]` | Switch LLM provider and model |
| `/language <name>` | Set your preferred response language |
| `/memories` | View what the agent remembers about you |
| `/reset` | Clear conversation history (memories are preserved) |
| `/status` | View agent status, token usage stats, and MCP service info |

Supported languages: english, italian, french, spanish, german, portuguese, chinese, japanese, korean, russian, arabic.

## Billing

PITI includes a billing client that connects to an external credit-based billing service via HTTP. The commercial billing backend is closed source, but the integration contract is simple and fully documented — you can build your own billing service in any language.

See [docs/billing.md](docs/billing.md) for the full API contract, cost calculation logic, and a minimal example implementation.

Billing is disabled by default (`billing.enabled: false` in `config.yaml`). When disabled, the agent runs with no credit limits and no usage restrictions — all billing checks are skipped entirely. This is the recommended setup for self-hosted or development deployments.

## HTTP API

PITI includes a local HTTP API for testing and building alternative frontends. See [docs/api.md](docs/api.md) for the full reference.

Quick example:

```bash
# Health check
curl http://localhost:3000/health

# Send a message
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, what can you help me with?"}'

# Check user status
curl http://localhost:3000/status/local
```

## Development

### Running in dev mode

```bash
# Start infrastructure
docker compose up -d postgres redis

# Build shared types
pnpm --filter @piti/shared build

# Run gateway with hot reload
pnpm dev:gateway
```

### Running tests

```bash
pnpm test
```

Tests use Vitest and cover guards, system prompt generation, config validation, auth middleware, language detection, and provider configuration.

## Extending PITI to a New Domain

PITI is designed as a reusable platform. To build a new AI agent on top of it:

1. **System prompt** (`packages/agent/src/agent/systemPrompt.ts`) -- Define your agent's personality, expertise, and instructions
2. **Guard rules** (`packages/agent/src/agent/guard.ts`) -- Configure topic boundaries (regex patterns + LLM classification prompt)
3. **Memory categories** -- Adjust categories in the schema to match your domain (e.g., replace fitness-specific ones with your own)
4. **MCP tools** (`config.yaml`) -- Add domain-specific tools via the MCP bridge
5. **Bot commands** -- Customize Telegram commands for your use case

The platform handles everything else: container orchestration, memory extraction, RAG search, multi-language support, token tracking, and billing.

### Project structure

```
piti/
├── config.example.yaml          # Configuration template
├── config.yaml                  # Your local config (gitignored)
├── docker-compose.yml           # PostgreSQL, Redis, MCP Bridge
├── ecosystem.config.cjs         # PM2 process config
├── vitest.config.ts             # Test configuration
├── scripts/
│   ├── init-db.sql              # Database schema setup
│   └── cleanup-containers.sh    # Remove stale agent containers
├── docs/
│   ├── api.md                   # HTTP API documentation
│   └── mcp.md                   # MCP integration documentation
├── packages/
│   ├── shared/                  # Shared types and utilities
│   │   └── src/
│   │       ├── types/
│   │       │   ├── agent.ts     # AgentRequest, AgentResponse, TokenUsage, McpCall
│   │       │   ├── config.ts    # GatewayConfig, AgentEnv, LLM_PROVIDERS, LLM_MODELS
│   │       │   ├── message.ts   # ChatMessage, Memory
│   │       │   └── user.ts      # UserProfile
│   │       └── utils/
│   │           ├── env.ts       # Environment validation
│   │           └── logger.ts    # Structured logging
│   ├── gateway/                 # Main process (Telegram + API + orchestration)
│   │   └── src/
│   │       ├── index.ts         # Entry point: loads config, starts all services
│   │       ├── api/
│   │       │   └── server.ts    # Local HTTP API (Fastify + CORS)
│   │       ├── bot/
│   │       │   ├── bot.ts       # Telegraf bot setup
│   │       │   ├── handlers/
│   │       │   │   ├── command.ts   # /start, /help, /provider, /language, etc.
│   │       │   │   └── message.ts   # Text, photo, and video message handling
│   │       │   └── middleware/
│   │       │       └── auth.ts      # User allowlist middleware
│   │       ├── db/
│   │       │   ├── client.ts    # Drizzle ORM client
│   │       │   └── schema.ts    # DB schema definitions
│   │       └── orchestrator/
│   │           ├── containerManager.ts  # Docker container lifecycle + health checks
│   │           ├── dispatcher.ts        # Request pipeline (user, history, dispatch, save)
│   │           └── mcpManager.ts        # MCP bridge container management
│   ├── agent/                   # AI agent (runs inside Docker containers)
│   │   └── src/
│   │       ├── index.ts         # Entry point
│   │       ├── server.ts        # Fastify HTTP server (/health, /chat)
│   │       ├── agent/
│   │       │   ├── trainer.ts       # Chat handler with routing + memory extraction
│   │       │   ├── guard.ts         # Off-topic detection (heuristic patterns)
│   │       │   └── systemPrompt.ts  # Dynamic system prompt with user context
│   │       ├── llm/
│   │       │   └── provider.ts  # LLM provider factory (Anthropic, OpenRouter, Kimi)
│   │       └── mcp/
│   │           └── client.ts    # MCP Bridge HTTP client, AI SDK tool generation
│   └── mcp-bridge/              # Python MCP server bridge
│       ├── main.py              # FastAPI app: spawns MCP servers, exposes HTTP
│       ├── requirements.txt     # Python dependencies
│       └── Dockerfile
└── tests/
    └── unit/                    # Vitest unit tests
        ├── guard.test.ts
        ├── systemPrompt.test.ts
        ├── config.test.ts
        ├── auth.test.ts
        ├── language.test.ts
        └── provider.test.ts
```

## Database Schema

PITI uses PostgreSQL 16 with pgvector. Schema is initialized from `scripts/init-db.sql`.

| Table | Purpose |
|-------|---------|
| `users` | User profiles, LLM preferences, language settings |
| `messages` | Conversation history (user + assistant turns) |
| `memories` | Long-term facts per user, categorized with optional vector embedding |
| `token_usage` | Per-call token counts by provider, model, and purpose (chat/classification/memory_extraction) |
| `mcp_calls` | MCP tool invocations with arguments, timing, and server info |

## License

Private.
