import Docker from "dockerode";
import type { McpServerConfig } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("mcp-manager");

const BRIDGE_CONTAINER = "piti-mcp-bridge";
const BRIDGE_IMAGE = "piti-mcp-bridge";
const BRIDGE_PORT = 5100;

export class McpManager {
  private docker: Docker;
  private configPath: string;

  constructor(configPath: string) {
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
    this.configPath = configPath;
  }

  /**
   * Ensure the MCP bridge container is running.
   * Returns the bridge URL for agent containers, or null if no MCP servers are enabled.
   */
  async ensureBridgeRunning(
    mcpConfig: Record<string, McpServerConfig>
  ): Promise<string | null> {
    // Check if any MCP servers are enabled
    const hasEnabled = Object.values(mcpConfig).some((cfg) => cfg.enabled);
    if (!hasEnabled) {
      logger.info("No MCP servers enabled, skipping bridge");
      return null;
    }

    try {
      // Check if bridge container already running
      const existing = this.docker.getContainer(BRIDGE_CONTAINER);
      const inspect = await existing.inspect();

      if (inspect.State.Running) {
        logger.info("MCP bridge already running");
        return `http://host.docker.internal:${BRIDGE_PORT}`;
      }

      // Container exists but not running — remove and recreate
      await existing.remove({ force: true }).catch(() => {});
    } catch {
      // Container doesn't exist, that's fine
    }

    try {
      const container = await this.docker.createContainer({
        Image: BRIDGE_IMAGE,
        name: BRIDGE_CONTAINER,
        ExposedPorts: { [`${BRIDGE_PORT}/tcp`]: {} },
        HostConfig: {
          PortBindings: {
            [`${BRIDGE_PORT}/tcp`]: [{ HostPort: `${BRIDGE_PORT}` }],
          },
          Binds: [`${this.configPath}:/app/config.yaml:ro`],
          RestartPolicy: { Name: "unless-stopped" },
        },
      });

      await container.start();

      // Wait for health check
      const healthy = await this.waitForHealth(BRIDGE_PORT, 15_000);
      if (!healthy) {
        logger.error("MCP bridge failed health check");
        return null;
      }

      logger.info("MCP bridge started", { port: BRIDGE_PORT });
      return `http://host.docker.internal:${BRIDGE_PORT}`;
    } catch (err) {
      logger.error("Failed to start MCP bridge", { error: err });
      return null;
    }
  }

  private async waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) return true;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }
}
