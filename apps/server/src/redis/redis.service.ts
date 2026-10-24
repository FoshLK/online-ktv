import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { RuntimeInfrastructureStatus } from "@ktv/contracts";
import { createClient, type RedisClientType } from "redis";

type ManagedRedisClient = RedisClientType;
type RedisConnectionStatus = RuntimeInfrastructureStatus["redis"];

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly redisUrl = process.env.REDIS_URL?.trim() ?? "";
  private readonly redisRequired = ["1", "true", "yes"].includes(
    (process.env.REDIS_REQUIRED ?? "false").trim().toLowerCase(),
  );
  private readonly connectionTimeoutMs = this.readPositiveInteger(
    process.env.REDIS_CONNECT_TIMEOUT_MS,
    1_500,
  );
  private readonly managedClients = new Set<ManagedRedisClient>();
  private primaryClient: ManagedRedisClient | null = null;
  private socketAdapter: RuntimeInfrastructureStatus["socketAdapter"] = "local";
  private connectPromise: Promise<boolean> | null = null;
  private lastConnectionWarningAt = 0;

  get configured(): boolean {
    return Boolean(this.redisUrl) && this.redisUrl !== "memory://";
  }

  get required(): boolean {
    return this.redisRequired;
  }

  get status(): RedisConnectionStatus {
    if (!this.configured) return "disabled";
    return this.primaryClient?.isReady ? "ready" : "unavailable";
  }

  get keyPrefix(): string {
    const configured = process.env.REDIS_KEY_PREFIX?.trim();
    return configured || "online-ktv";
  }

  async connect(): Promise<boolean> {
    if (!this.configured) {
      if (this.redisRequired) throw new Error("REDIS_REQUIRED=true，但 REDIS_URL 未配置为可连接地址");
      this.logger.log("REDIS_URL 未配置，在线状态与实时广播使用单进程模式");
      return false;
    }
    if (this.primaryClient?.isReady) return true;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.openPrimaryClient();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  getClient(): ManagedRedisClient | null {
    return this.primaryClient?.isReady ? this.primaryClient : null;
  }

  async createConnectedDuplicate(): Promise<ManagedRedisClient | null> {
    const primary = this.getClient();
    if (!primary) return null;

    const duplicate = primary.duplicate();
    duplicate.on("error", (error) => {
      this.reportConnectionError("实时广播", error);
    });
    this.managedClients.add(duplicate);
    try {
      await this.connectWithinTimeout(duplicate);
      return duplicate;
    } catch (error) {
      this.managedClients.delete(duplicate);
      duplicate.destroy();
      this.logger.warn(`Redis 实时广播连接失败：${this.errorMessage(error)}`);
      return null;
    }
  }

  async releaseClient(client: ManagedRedisClient): Promise<void> {
    this.managedClients.delete(client);
    if (client.isOpen) await client.close();
    else client.destroy();
  }

  setSocketAdapter(mode: RuntimeInfrastructureStatus["socketAdapter"]): void {
    this.socketAdapter = mode;
  }

  getRuntimeStatus(): RuntimeInfrastructureStatus {
    const redis = this.status;
    const presenceStore = redis === "ready" ? "redis" : "memory";
    const socketAdapter = redis === "ready" ? this.socketAdapter : "local";
    const distributed = redis === "ready" && socketAdapter === "redis";
    return {
      mode: distributed ? "distributed" : "single-instance",
      redis,
      presenceStore,
      socketAdapter,
    };
  }

  key(suffix: string): string {
    return `${this.keyPrefix}:${suffix}`;
  }

  async onModuleDestroy(): Promise<void> {
    const clients = [...this.managedClients];
    this.managedClients.clear();
    this.primaryClient = null;
    await Promise.allSettled(clients.map((client) => this.releaseClient(client)));
  }

  private async openPrimaryClient(): Promise<boolean> {
    let runtimeReconnectEnabled = false;
    const client = createClient({
      url: this.redisUrl,
      socket: {
        connectTimeout: this.connectionTimeoutMs,
        reconnectStrategy: (retries) => runtimeReconnectEnabled
          ? Math.min(100 * 2 ** Math.min(retries, 5), 3_000)
          : false,
      },
    });
    client.on("error", (error) => {
      this.reportConnectionError("在线状态", error);
    });
    this.managedClients.add(client);

    try {
      await client.connect();
      runtimeReconnectEnabled = true;
      this.primaryClient = client;
      this.logger.log(`Redis 已连接（${this.safeEndpoint()}）`);
      return true;
    } catch (error) {
      this.managedClients.delete(client);
      client.destroy();
      const message = `Redis 无法连接（${this.safeEndpoint()}），已回退到单进程模式：${this.errorMessage(error)}`;
      if (this.redisRequired) throw new Error(message, { cause: error });
      this.logger.warn(message);
      return false;
    }
  }

  private safeEndpoint(): string {
    try {
      const endpoint = new URL(this.redisUrl);
      return `${endpoint.protocol}//${endpoint.host}`;
    } catch {
      return "已配置地址";
    }
  }

  private readPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async connectWithinTimeout(client: ManagedRedisClient): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect().then(() => undefined),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`连接等待超过 ${this.connectionTimeoutMs} ms`)),
            this.connectionTimeoutMs,
          );
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private reportConnectionError(scope: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastConnectionWarningAt < 10_000) return;
    this.lastConnectionWarningAt = now;
    this.logger.warn(`Redis ${scope}连接异常：${this.errorMessage(error)}`);
  }
}
