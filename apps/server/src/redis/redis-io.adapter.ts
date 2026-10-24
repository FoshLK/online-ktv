import { Logger, type INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Server, ServerOptions } from "socket.io";
import { RedisService } from "./redis.service.js";

export class RedisIoAdapter extends IoAdapter {
  private readonly adapterLogger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly redis: RedisService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<boolean> {
    if (!this.redis.getClient()) return false;

    const [publisher, subscriber] = await Promise.all([
      this.redis.createConnectedDuplicate(),
      this.redis.createConnectedDuplicate(),
    ]);
    if (!publisher || !subscriber) {
      await Promise.allSettled(
        [publisher, subscriber].filter((client) => client !== null).map((client) => this.redis.releaseClient(client)),
      );
      this.redis.setSocketAdapter("local");
      if (this.redis.required) throw new Error("REDIS_REQUIRED=true，但 Socket.IO Redis Adapter 初始化失败");
      this.adapterLogger.warn("Socket.IO Redis Adapter 初始化失败，继续使用本机广播");
      return false;
    }

    this.adapterConstructor = createAdapter(publisher, subscriber);
    this.redis.setSocketAdapter("redis");
    this.adapterLogger.log("Socket.IO 已启用 Redis 跨进程广播");
    return true;
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
