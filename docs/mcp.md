# MCP (Model Context Protocol) Integration

PITI uses a custom **MCP Bridge** architecture that gives the AI agent access to external tools (web search, content fetching, etc.) without requiring complex networking or persistent connections between containers.

## Architecture

```
                         ┌─────────────────────────────────┐
                         │       Mac Pro / Server           │
                         │                                  │
┌──────────┐   HTTP      │  ┌──────────────────────────┐   │
│ Telegram │◄───────────►│  │     Gateway (pm2)        │   │
└──────────┘             │  │  - Telegram bot           │   │
                         │  │  - HTTP API (:3000)       │   │
┌──────────┐   HTTP      │  │  - Starts MCP Bridge      │   │
│ HTTP API │◄───────────►│  │  - Passes bridge URL to   │   │
│ clients  │             │  │    agent containers        │   │
└──────────┘             │  └──────────┬───────────────┘   │
                         │             │                    │
                         │             │ creates            │
                         │             ▼                    │
                         │  ┌──────────────────────────┐   │
                         │  │  Agent Container (Docker) │   │
                         │  │  - Ephemeral, per-user    │   │
                         │  │  - Calls LLM              │   │
                         │  │  - HTTP calls to bridge   │   │
                         │  └──────────┬───────────────┘   │
                         │             │                    │
                         │             │ HTTP (:5100)       │
                         │             ▼                    │
                         │  ┌──────────────────────────┐   │
                         │  │  MCP Bridge (Docker)      │   │
                         │  │  - Python FastAPI          │   │
                         │  │  - Reads config.yaml       │   │
                         │  │  - pip installs MCP pkgs   │   │
                         │  │  - Spawns servers (stdio)  │   │
                         │  │  - Exposes HTTP API        │   │
                         │  │                            │   │
                         │  │  ┌─ stdio ─► DuckDuckGo   │   │
                         │  │  ├─ stdio ─► Future MCP 1  │   │
                         │  │  └─ stdio ─► Future MCP 2  │   │
                         │  └──────────────────────────┘   │
                         └─────────────────────────────────┘
```

## How It Works

### 1. Single Configuration File

Everything is controlled from `config.yaml` at the repo root. The `mcp` section defines which MCP servers to run:

```yaml
mcp:
  search:
    enabled: true
    package: "duckduckgo-mcp-server"
    command: ["python", "-m", "duckduckgo_mcp_server.server"]
  # Add more MCP servers here:
  # nutrition:
  #   enabled: false
  #   package: "some-nutrition-mcp"
  #   command: ["python", "-m", "nutrition_mcp.server"]
```

Each entry has:
- **`enabled`**: Toggle on/off without removing the config
- **`package`**: pip package name — installed dynamically at bridge startup
- **`command`**: How to spawn the MCP server process (stdio transport)

### 2. MCP Bridge Container

The bridge (`piti-mcp-bridge`) is a single Docker container that:

1. **Reads `config.yaml`** (mounted as a volume)
2. **`pip install`s** all enabled MCP packages at startup
3. **Spawns each MCP server** as a stdio subprocess using the MCP Python SDK
4. **Connects to each server** and discovers available tools
5. **Exposes an HTTP API** for the agent containers to use

This means:
- **No SSE/WebSocket complexity** — MCP servers run as simple stdio processes
- **No per-server Docker containers** — everything lives in one container
- **Adding a new MCP server** = add 3 lines to `config.yaml` + rebuild the bridge
- **No code changes needed** in the agent or gateway

### 3. Agent Integration

When the gateway creates an agent container, it passes `MCP_BRIDGE_URL=http://host.docker.internal:5100` as an environment variable.

On the agent's first request:
1. Fetches available tools from `GET /tools`
2. Converts each tool's JSON Schema into a Zod schema
3. Creates AI SDK `tool()` definitions that proxy calls to the bridge
4. Passes tools to `generateText()` — the LLM decides when to use them

The LLM sees tools like:
- `search_search` — Search DuckDuckGo
- `search_fetch_content` — Fetch and parse a webpage

When the LLM calls a tool, the AI SDK executes it, which makes an HTTP call to the bridge, which calls the MCP server via stdio, and returns the result.

### 4. Tracking & Billing

Every MCP tool call is tracked in the `mcp_calls` PostgreSQL table:

| Column | Description |
|--------|-------------|
| `user_id` | Which user triggered the call |
| `server` | MCP server name (e.g., "search") |
| `tool` | Tool name (e.g., "search", "fetch_content") |
| `args` | JSON arguments passed to the tool |
| `duration_ms` | How long the call took |
| `created_at` | Timestamp |

View usage via:
- **Telegram**: `/status` command
- **HTTP API**: `GET /status/local`
- **SQL**: `SELECT * FROM mcp_calls WHERE user_id = 1;`

## MCP Bridge HTTP API

The bridge exposes three endpoints:

### `GET /health`
```json
{"status": "ok", "servers": 1, "tools": 2}
```

### `GET /tools`
Lists all available tools from all connected MCP servers:
```json
{
  "tools": [
    {
      "name": "search/search",
      "description": "Search DuckDuckGo and return formatted results.",
      "input_schema": {
        "properties": {
          "query": {"type": "string"},
          "max_results": {"type": "integer", "default": 10}
        },
        "required": ["query"]
      }
    },
    {
      "name": "search/fetch_content",
      "description": "Fetch and parse content from a webpage URL.",
      "input_schema": {
        "properties": {
          "url": {"type": "string"}
        },
        "required": ["url"]
      }
    }
  ]
}
```

### `POST /call`
Execute a tool:
```json
{
  "tool": "search/search",
  "args": {"query": "best protein sources", "max_results": 3}
}
```
Response:
```json
{
  "result": "Found 3 search results:\n\n1. ..."
}
```

## Adding a New MCP Server

### Step 1: Find the MCP server package

Browse [MCP servers on npm](https://www.npmjs.com/search?q=mcp-server) or [PyPI](https://pypi.org/search/?q=mcp+server).

### Step 2: Add to config.yaml

```yaml
mcp:
  search:
    enabled: true
    package: "duckduckgo-mcp-server"
    command: ["python", "-m", "duckduckgo_mcp_server.server"]
  weather:
    enabled: true
    package: "weather-mcp-server"
    command: ["python", "-m", "weather_mcp"]
```

### Step 3: Rebuild the bridge

```bash
docker rm -f piti-mcp-bridge
pm2 restart piti-gateway
```

The gateway will recreate the bridge container, which will install the new package and connect to the new server. Agent containers will automatically discover the new tools on their next request.

### Step 4: Verify

```bash
curl http://localhost:5100/tools
```

## Environment Variables

The bridge needs no env vars — it reads everything from `config.yaml`.

If an MCP server needs API keys, add an `env` section (not yet implemented but planned):

```yaml
mcp:
  tavily_search:
    enabled: true
    package: "tavily-mcp"
    command: ["python", "-m", "tavily_mcp.server"]
    env:
      TAVILY_API_KEY: "tvly-..."
```

## Design Decisions

### Why a bridge instead of direct MCP connections?

1. **MCP servers use stdio** — they're designed to run as child processes, not network services. Converting them to SSE/HTTP is fragile and not all servers support it.
2. **One container, many servers** — instead of N Docker containers for N MCP servers, everything runs in one.
3. **Dynamic setup** — `pip install` at startup means no custom Dockerfiles per MCP server.
4. **Agent simplicity** — agents make plain HTTP calls, no MCP SDK needed on the Node.js side.

### Why HTTP instead of SSE/WebSocket?

- HTTP is stateless and simple — fits the ephemeral agent container model
- No connection management needed
- Easy to test with `curl`
- No special client libraries required

### Why track MCP calls separately from token usage?

- MCP calls have different cost characteristics (API rate limits, external service costs)
- Duration tracking helps identify slow tools
- Enables per-tool billing if needed
- Args tracking provides audit trail
