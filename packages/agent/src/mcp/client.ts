import { tool } from "ai";
import { z } from "zod";
import { createLogger } from "@piti/shared";

const logger = createLogger("mcp-client");

interface BridgeTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

/**
 * Connect to the MCP Bridge HTTP service and create AI SDK tool definitions.
 * The bridge URL is passed via MCP_BRIDGE_URL env var.
 */
export async function connectMcpTools(): Promise<Record<string, any>> {
  const bridgeUrl = process.env.MCP_BRIDGE_URL;
  if (!bridgeUrl) {
    return {};
  }

  try {
    // Fetch available tools from the bridge
    const resp = await fetch(`${bridgeUrl}/tools`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      logger.warn("MCP Bridge /tools returned error", { status: resp.status });
      return {};
    }

    const data = (await resp.json()) as { tools: BridgeTool[] };
    const tools: Record<string, any> = {};

    for (const bridgeTool of data.tools) {
      // Convert JSON Schema to Zod schema for AI SDK
      const zodSchema = jsonSchemaToZod(bridgeTool.input_schema);

      tools[bridgeTool.name.replace("/", "_")] = tool({
        description: bridgeTool.description.trim(),
        parameters: zodSchema,
        execute: async (args: any) => {
          try {
            const callResp = await fetch(`${bridgeUrl}/call`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tool: bridgeTool.name, args }),
              signal: AbortSignal.timeout(30000),
            });

            if (!callResp.ok) {
              const errText = await callResp.text();
              return `Tool error: ${errText}`;
            }

            const result = (await callResp.json()) as { result: string };
            return result.result;
          } catch (err) {
            logger.warn("MCP tool call failed", { tool: bridgeTool.name, error: err });
            return `Tool call failed: ${err}`;
          }
        },
      });
    }

    logger.info("MCP tools loaded from bridge", {
      url: bridgeUrl,
      tools: Object.keys(tools),
    });

    return tools;
  } catch (err) {
    logger.warn("Failed to connect to MCP Bridge", { url: bridgeUrl, error: err });
    return {};
  }
}

/**
 * Convert a JSON Schema object to a Zod schema.
 * Handles the common types used by MCP tools.
 */
function jsonSchemaToZod(schema: Record<string, any>): z.ZodType {
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, prop] of Object.entries(properties) as [string, any][]) {
    let field: z.ZodType;

    switch (prop.type) {
      case "string":
        field = z.string().describe(prop.description || prop.title || key);
        break;
      case "integer":
        field = z.number().int().describe(prop.description || prop.title || key);
        break;
      case "number":
        field = z.number().describe(prop.description || prop.title || key);
        break;
      case "boolean":
        field = z.boolean().describe(prop.description || prop.title || key);
        break;
      default:
        field = z.any().describe(prop.description || prop.title || key);
    }

    if (prop.default !== undefined) {
      field = field.default(prop.default) as any;
    }

    if (!required.has(key)) {
      field = field.optional() as any;
    }

    shape[key] = field;
  }

  return z.object(shape);
}
