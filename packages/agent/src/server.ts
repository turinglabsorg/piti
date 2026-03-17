import Fastify from "fastify";
import { handleChat } from "./agent/trainer.js";
import { connectMcpTools } from "./mcp/client.js";
import type { AgentRequest } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("agent-server");

export function createServer() {
  const app = Fastify({ logger: false });

  // MCP tools — initialized lazily on first request
  let mcpTools: Record<string, any> | null = null;
  let mcpCleanup: (() => Promise<void>) | null = null;
  let mcpInitialized = false;

  async function getMcpTools(): Promise<Record<string, any>> {
    if (!mcpInitialized) {
      mcpInitialized = true;
      try {
        const result = await connectMcpTools();
        mcpTools = result.tools;
        mcpCleanup = result.cleanup;
      } catch (err) {
        logger.warn("MCP tools initialization failed", { error: err });
        mcpTools = {};
      }
    }
    return mcpTools || {};
  }

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.post<{ Body: AgentRequest }>("/chat", async (request, reply) => {
    try {
      const tools = await getMcpTools();
      const result = await handleChat(request.body, tools);
      return result;
    } catch (err) {
      logger.error("Chat handler error", { error: err });
      reply.status(500).send({ error: "Internal agent error" });
    }
  });

  // Cleanup hook
  app.addHook("onClose", async () => {
    if (mcpCleanup) {
      await mcpCleanup();
    }
  });

  return app;
}
