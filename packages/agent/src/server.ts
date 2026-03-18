import Fastify from "fastify";
import { handleChat } from "./agent/trainer.js";
import { connectMcpTools, type McpToolsResult } from "./mcp/client.js";
import type { AgentRequest } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("agent-server");

export function createServer() {
  const app = Fastify({ logger: false });

  // MCP tools — initialized lazily on first request
  let mcpResult: McpToolsResult | null = null;

  async function getMcpResult(): Promise<McpToolsResult> {
    if (mcpResult === null) {
      mcpResult = await connectMcpTools();
    }
    return mcpResult;
  }

  // Authentication middleware — verify shared secret from gateway
  const agentSecret = process.env.AGENT_SECRET;
  if (agentSecret) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/health") return;

      const authHeader = request.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${agentSecret}`) {
        reply.status(401).send({ error: "Unauthorized" });
        return;
      }
    });
    logger.info("Agent authentication enabled");
  } else {
    logger.warn("Agent running without authentication (AGENT_SECRET not set)");
  }

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.post<{ Body: AgentRequest }>("/chat", async (request, reply) => {
    try {
      const mcp = await getMcpResult();
      // Clear calls from previous request
      mcp.calls.length = 0;
      const result = await handleChat(request.body, mcp.tools);
      // Attach MCP calls to the response
      result.mcpCalls = mcp.calls.slice();
      return result;
    } catch (err) {
      logger.error("Chat handler error", { error: err });
      reply.status(500).send({ error: "Internal agent error" });
    }
  });

  return app;
}
