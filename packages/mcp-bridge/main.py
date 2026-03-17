"""
MCP Bridge — reads config.yaml, pip-installs MCP packages,
spawns them as stdio subprocesses, exposes tools via HTTP.

Endpoints:
  GET  /health  → health check
  GET  /tools   → list all tools
  POST /call    → { "tool": "server/tool", "args": { ... } }
"""

import asyncio
import logging
import os
import subprocess
import sys
from contextlib import asynccontextmanager
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("mcp-bridge")

CONFIG_PATH = os.environ.get("CONFIG_PATH", "/app/config.yaml")


class ToolCallRequest(BaseModel):
    tool: str
    args: dict[str, Any] = {}


class McpServer:
    def __init__(self, name: str, command: list[str]):
        self.name = name
        self.command = command
        self.session: ClientSession | None = None
        self.tools: dict[str, Any] = {}
        self._cm = None
        self._session_cm = None

    async def connect(self):
        try:
            params = StdioServerParameters(command=self.command[0], args=self.command[1:])
            self._cm = stdio_client(params)
            read, write = await self._cm.__aenter__()
            self._session_cm = ClientSession(read, write)
            self.session = await self._session_cm.__aenter__()
            await self.session.initialize()

            result = await self.session.list_tools()
            for tool in result.tools:
                self.tools[tool.name] = {
                    "name": tool.name,
                    "description": tool.description or "",
                    "input_schema": tool.inputSchema if hasattr(tool, "inputSchema") else {},
                }
            logger.info(f"Connected to '{self.name}': {list(self.tools.keys())}")
        except Exception as e:
            logger.error(f"Failed to connect to '{self.name}': {e}")
            self.session = None
            self.tools = {}

    async def call_tool(self, tool_name: str, args: dict) -> str:
        if not self.session:
            raise RuntimeError(f"Server '{self.name}' not connected")
        result = await self.session.call_tool(tool_name, args)
        texts = []
        for content in result.content:
            texts.append(content.text if hasattr(content, "text") else str(content))
        return "\n".join(texts)

    async def disconnect(self):
        try:
            if self._session_cm:
                await self._session_cm.__aexit__(None, None, None)
            if self._cm:
                await self._cm.__aexit__(None, None, None)
        except Exception:
            pass


servers: dict[str, McpServer] = {}


def load_mcp_config() -> list[dict]:
    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)
    mcp = config.get("mcp", {})
    result = []
    for name, cfg in mcp.items():
        if cfg.get("enabled", False):
            result.append({"name": name, "package": cfg.get("package"), "command": cfg.get("command", [])})
    return result


def install_packages(configs: list[dict]):
    packages = [c["package"] for c in configs if c.get("package")]
    if not packages:
        return
    logger.info(f"Installing MCP packages: {packages}")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet"] + packages)
    logger.info("Packages installed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configs = load_mcp_config()
    install_packages(configs)

    for cfg in configs:
        srv = McpServer(name=cfg["name"], command=cfg["command"])
        await srv.connect()
        if srv.session:
            servers[srv.name] = srv

    total_tools = sum(len(s.tools) for s in servers.values())
    logger.info(f"MCP Bridge ready — {len(servers)} server(s), {total_tools} tool(s)")
    yield

    for srv in servers.values():
        await srv.disconnect()


app = FastAPI(title="MCP Bridge", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "servers": len(servers), "tools": sum(len(s.tools) for s in servers.values())}


@app.get("/tools")
async def list_tools():
    all_tools = []
    for srv in servers.values():
        for tool_name, info in srv.tools.items():
            all_tools.append({
                "name": f"{srv.name}/{tool_name}",
                "description": info["description"],
                "input_schema": info["input_schema"],
            })
    return {"tools": all_tools}


@app.post("/call")
async def call_tool(req: ToolCallRequest):
    parts = req.tool.split("/", 1)
    if len(parts) != 2:
        raise HTTPException(400, f"Use 'server/tool' format, got '{req.tool}'")

    server_name, tool_name = parts
    srv = servers.get(server_name)
    if not srv:
        raise HTTPException(404, f"Server '{server_name}' not found")
    if tool_name not in srv.tools:
        raise HTTPException(404, f"Tool '{tool_name}' not found on '{server_name}'")

    try:
        result = await srv.call_tool(tool_name, req.args)
        return {"result": result}
    except Exception as e:
        logger.error(f"Tool call failed: {e}")
        raise HTTPException(500, f"Tool call failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5100)
