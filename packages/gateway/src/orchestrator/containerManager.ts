import Docker from "dockerode";
import type { Redis } from "ioredis";
import type { AgentRequest, AgentResponse } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("container-manager");

export interface ContainerInfo {
  containerId: string;
  port: number;
  userId: number;
  lastActivity: number;
  status: "starting" | "ready" | "stopping";
}

export class ContainerManager {
  private docker: Docker;
  private redis: Redis;
  private imageName: string;
  private portStart: number;
  private portEnd: number;
  private idleTimeoutMs: number;
  private agentSecret: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    redis: Redis,
    opts: {
      imageName: string;
      portStart: number;
      portEnd: number;
      idleTimeoutMs: number;
      agentSecret: string;
    }
  ) {
    // Support Docker socket proxy via DOCKER_HOST env var
    const dockerHost = process.env.DOCKER_HOST;
    if (dockerHost && dockerHost.startsWith("tcp://")) {
      const url = new URL(dockerHost);
      this.docker = new Docker({ host: url.hostname, port: Number(url.port) });
    } else {
      this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
    }
    this.redis = redis;
    this.imageName = opts.imageName;
    this.portStart = opts.portStart;
    this.portEnd = opts.portEnd;
    this.idleTimeoutMs = opts.idleTimeoutMs;
    this.agentSecret = opts.agentSecret;
  }

  async start() {
    // Start cleanup interval every 60s
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    logger.info("Container manager started", {
      image: this.imageName,
      portRange: `${this.portStart}-${this.portEnd}`,
    });
  }

  async stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    // Destroy all containers
    const keys = await this.redis.keys("piti:container:*");
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const info: ContainerInfo = JSON.parse(data);
        await this.destroyContainer(info.userId).catch(() => {});
      }
    }
    logger.info("Container manager stopped");
  }

  async getOrCreateContainer(
    userId: number,
    envVars: Record<string, string>
  ): Promise<ContainerInfo> {
    const key = `piti:container:${userId}`;
    const existing = await this.redis.get(key);

    if (existing) {
      const info: ContainerInfo = JSON.parse(existing);
      // Check if container is still alive
      try {
        const container = this.docker.getContainer(info.containerId);
        const inspect = await container.inspect();
        if (inspect.State.Running) {
          // Update last activity
          info.lastActivity = Date.now();
          await this.redis.set(key, JSON.stringify(info));
          return info;
        }
      } catch {
        // Container gone, remove from registry
        await this.redis.del(key);
      }
    }

    // Allocate a port atomically
    const port = await this.allocatePort();
    if (!port) {
      throw new Error("No available ports for new container");
    }

    const containerName = `piti-agent-${userId}`;

    // Remove any stale container with same name
    try {
      const old = this.docker.getContainer(containerName);
      await old.stop().catch(() => {});
      await old.remove({ force: true }).catch(() => {});
    } catch {
      // Container doesn't exist, that's fine
    }

    const envArray = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);
    envArray.push(`PORT=${port}`);
    envArray.push(`AGENT_SECRET=${this.agentSecret}`);

    const container = await this.docker.createContainer({
      Image: this.imageName,
      name: containerName,
      Env: envArray,
      ExposedPorts: { [`${port}/tcp`]: {} },
      HostConfig: {
        PortBindings: {
          [`${port}/tcp`]: [{ HostPort: `${port}` }],
        },
      },
    });

    await container.start();

    const info: ContainerInfo = {
      containerId: container.id,
      port,
      userId,
      lastActivity: Date.now(),
      status: "starting",
    };

    // Wait for health check
    const healthy = await this.waitForHealth(port, 30_000);
    if (!healthy) {
      await container.stop().catch(() => {});
      await container.remove({ force: true }).catch(() => {});
      await this.redis.srem("piti:ports", port.toString());
      throw new Error(`Container for user ${userId} failed health check`);
    }

    info.status = "ready";
    await this.redis.set(key, JSON.stringify(info));

    logger.info("Container created", { userId, containerId: container.id, port });
    return info;
  }

  async sendMessage(userId: number, request: AgentRequest): Promise<AgentResponse> {
    const key = `piti:container:${userId}`;
    const data = await this.redis.get(key);
    if (!data) {
      throw new Error(`No container for user ${userId}`);
    }

    const info: ContainerInfo = JSON.parse(data);
    const url = `http://localhost:${info.port}/chat`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.agentSecret}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Agent returned ${response.status}: ${text}`);
    }

    // Update last activity
    info.lastActivity = Date.now();
    await this.redis.set(key, JSON.stringify(info));

    return (await response.json()) as AgentResponse;
  }

  async destroyContainer(userId: number) {
    const key = `piti:container:${userId}`;
    const data = await this.redis.get(key);
    if (!data) return;

    const info: ContainerInfo = JSON.parse(data);

    try {
      const container = this.docker.getContainer(info.containerId);
      await container.stop({ t: 5 });
      await container.remove({ force: true });
    } catch (err) {
      logger.warn("Failed to destroy container", { userId, error: err });
    }

    await this.redis.del(key);
    await this.redis.srem("piti:ports", info.port.toString());
    logger.info("Container destroyed", { userId, containerId: info.containerId });
  }

  private async cleanup() {
    const keys = await this.redis.keys("piti:container:*");
    const now = Date.now();

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (!data) continue;

      const info: ContainerInfo = JSON.parse(data);
      if (now - info.lastActivity > this.idleTimeoutMs) {
        logger.info("Cleaning up idle container", { userId: info.userId });
        await this.destroyContainer(info.userId);
      }
    }
  }

  /**
   * Atomically allocate a port using a Redis Lua script.
   * This prevents race conditions when multiple requests try to allocate simultaneously.
   */
  private async allocatePort(): Promise<number | null> {
    const script = `
      for port = tonumber(ARGV[1]), tonumber(ARGV[2]) do
        if redis.call("SADD", KEYS[1], port) == 1 then
          return port
        end
      end
      return nil
    `;
    const result = await this.redis.eval(
      script, 1, "piti:ports",
      this.portStart.toString(), this.portEnd.toString()
    );
    return result ? Number(result) : null;
  }

  private async waitForHealth(
    port: number,
    timeoutMs: number
  ): Promise<boolean> {
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
