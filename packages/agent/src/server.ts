import Fastify from "fastify";
import { handleChat } from "./agent/trainer.js";
import type { AgentRequest } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("agent-server");

export function createServer() {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.post<{ Body: AgentRequest }>("/chat", async (request, reply) => {
    try {
      const result = await handleChat(request.body);
      return result;
    } catch (err) {
      logger.error("Chat handler error", { error: err });
      reply.status(500).send({ error: "Internal agent error" });
    }
  });

  return app;
}
