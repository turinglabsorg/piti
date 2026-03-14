import "dotenv/config";
import { createServer } from "./server.js";
import { createLogger } from "@piti/shared";

const logger = createLogger("agent");

async function main() {
  const port = Number(process.env.PORT) || 3001;
  const server = createServer();

  await server.listen({ port, host: "0.0.0.0" });
  logger.info(`Agent server listening on port ${port}`);
}

main().catch((err) => {
  logger.error("Fatal error", { error: err });
  process.exit(1);
});
