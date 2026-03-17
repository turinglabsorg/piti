import Docker from "dockerode";
import type { McpServerConfig } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("mcp-manager");

export interface McpServerInfo {
  name: string;
  url: string;
}

export class McpManager {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
  }

  /**
   * For each enabled MCP server in config, ensure the Docker container is running.
   * Returns an array of MCP server connection info to pass to agents.
   */
  async ensureRunning(
    mcpConfig: Record<string, McpServerConfig>
  ): Promise<McpServerInfo[]> {
    const servers: McpServerInfo[] = [];

    for (const [name, cfg] of Object.entries(mcpConfig)) {
      if (!cfg.enabled) {
        logger.info("MCP server disabled, skipping", { name });
        continue;
      }

      const containerName = `piti-mcp-${name}`;

      try {
        // Check if container already running
        const existing = this.docker.getContainer(containerName);
        const inspect = await existing.inspect();

        if (inspect.State.Running) {
          logger.info("MCP server already running", { name, containerName });
          servers.push({
            name,
            url: `http://host.docker.internal:${cfg.port}/sse`,
          });
          continue;
        }

        // Container exists but not running — remove and recreate
        await existing.remove({ force: true }).catch(() => {});
      } catch {
        // Container doesn't exist, that's fine
      }

      try {
        const containerOpts: any = {
          Image: cfg.image,
          name: containerName,
          ExposedPorts: { [`${cfg.port}/tcp`]: {} },
          HostConfig: {
            PortBindings: {
              [`${cfg.port}/tcp`]: [{ HostPort: `${cfg.port}` }],
            },
            RestartPolicy: { Name: "unless-stopped" },
          },
        };

        if (cfg.command) {
          containerOpts.Cmd = cfg.command;
        }

        if (cfg.env) {
          containerOpts.Env = Object.entries(cfg.env).map(([k, v]) => `${k}=${v}`);
        }

        const container = await this.docker.createContainer(containerOpts);

        await container.start();
        logger.info("MCP server started", { name, containerName, port: cfg.port });

        // Wait briefly for it to be ready
        await new Promise((r) => setTimeout(r, 3000));

        servers.push({
          name,
          url: `http://host.docker.internal:${cfg.port}/sse`,
        });
      } catch (err) {
        logger.error("Failed to start MCP server", { name, error: err });
        // Non-fatal: agent can work without MCP tools
      }
    }

    return servers;
  }
}
