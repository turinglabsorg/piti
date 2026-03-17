import { experimental_createMCPClient as createMCPClient } from "ai";
import { createLogger } from "@piti/shared";

const logger = createLogger("mcp-client");

interface McpServerEntry {
  name: string;
  url: string;
}

/**
 * Parse the MCP_SERVERS env var and connect to each MCP server.
 * Returns a merged tools object for use with generateText().
 * Failures are logged but non-fatal — returns empty tools if all fail.
 */
export async function connectMcpTools(): Promise<{
  tools: Record<string, any>;
  cleanup: () => Promise<void>;
}> {
  const mcpServersRaw = process.env.MCP_SERVERS;
  if (!mcpServersRaw) {
    return { tools: {}, cleanup: async () => {} };
  }

  let entries: McpServerEntry[];
  try {
    entries = JSON.parse(mcpServersRaw);
  } catch (err) {
    logger.warn("Failed to parse MCP_SERVERS env var", { error: err });
    return { tools: {}, cleanup: async () => {} };
  }

  const allTools: Record<string, any> = {};
  const clients: Array<Awaited<ReturnType<typeof createMCPClient>>> = [];

  for (const entry of entries) {
    try {
      const client = await createMCPClient({
        transport: {
          type: "sse",
          url: entry.url,
        },
      });

      clients.push(client);

      const serverTools = await client.tools();
      // Namespace tools with server name prefix to avoid collisions
      for (const [toolName, tool] of Object.entries(serverTools)) {
        allTools[`${entry.name}_${toolName}`] = tool;
      }

      logger.info("Connected to MCP server", {
        name: entry.name,
        tools: Object.keys(serverTools),
      });
    } catch (err) {
      logger.warn("Failed to connect to MCP server", {
        name: entry.name,
        url: entry.url,
        error: err,
      });
      // Non-fatal: continue without this server's tools
    }
  }

  const cleanup = async () => {
    for (const client of clients) {
      try {
        await client.close();
      } catch {
        // ignore cleanup errors
      }
    }
  };

  logger.info("MCP tools loaded", { count: Object.keys(allTools).length });
  return { tools: allTools, cleanup };
}
