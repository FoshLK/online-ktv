import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeInfrastructureStatus } from "@ktv/contracts";
import type { RedisService } from "../redis/redis.service.js";
import { RoomPresenceService } from "./room-presence.service.js";

type Operation = () => void;

class FakeRedisMulti {
  private readonly operations: Operation[] = [];

  constructor(private readonly redis: FakeRedisClient) {}

  set(key: string, value: string, _options?: { EX: number }): this {
    this.operations.push(() => this.redis.strings.set(key, value));
    return this;
  }

  del(key: string): this {
    this.operations.push(() => this.redis.strings.delete(key));
    return this;
  }

  zAdd(key: string, entry: { score: number; value: string }): this {
    this.operations.push(() => this.redis.sortedSet(key).set(entry.value, entry.score));
    return this;
  }

  zRem(key: string, values: string | string[]): this {
    const entries = Array.isArray(values) ? values : [values];
    this.operations.push(() => {
      for (const value of entries) this.redis.sortedSet(key).delete(value);
    });
    return this;
  }

  async exec(): Promise<unknown[]> {
    for (const operation of this.operations) operation();
    return [];
  }
}

class FakeRedisClient {
  readonly strings = new Map<string, string>();
  readonly sortedSets = new Map<string, Map<string, number>>();

  multi(): FakeRedisMulti {
    return new FakeRedisMulti(this);
  }

  async time(): Promise<[string, string]> {
    const now = Date.now();
    return [String(Math.floor(now / 1_000)), String((now % 1_000) * 1_000)];
  }

  async zRem(key: string, values: string | string[]): Promise<number> {
    const entries = Array.isArray(values) ? values : [values];
    let removed = 0;
    for (const value of entries) {
      if (this.sortedSet(key).delete(value)) removed += 1;
    }
    return removed;
  }

  async zRemRangeByScore(key: string, minimum: number, maximum: number): Promise<number> {
    let removed = 0;
    for (const [value, score] of this.sortedSet(key)) {
      if (score >= minimum && score <= maximum) {
        this.sortedSet(key).delete(value);
        removed += 1;
      }
    }
    return removed;
  }

  async zRangeByScore(key: string, minimum: number, maximum: string): Promise<string[]> {
    const upper = maximum === "+inf" ? Number.POSITIVE_INFINITY : Number(maximum);
    return [...this.sortedSet(key)]
      .filter(([, score]) => score >= minimum && score <= upper)
      .sort((left, right) => left[1] - right[1])
      .map(([value]) => value);
  }

  async mGet(keys: string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.strings.get(key) ?? null);
  }

  sortedSet(key: string): Map<string, number> {
    const existing = this.sortedSets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    this.sortedSets.set(key, created);
    return created;
  }
}

function createRedisFacade(client: FakeRedisClient | null): RedisService {
  const runtime: RuntimeInfrastructureStatus = client ? {
    mode: "distributed",
    redis: "ready",
    presenceStore: "redis",
    socketAdapter: "redis",
  } : {
    mode: "single-instance",
    redis: "disabled",
    presenceStore: "memory",
    socketAdapter: "local",
  };
  return {
    getClient: () => client,
    key: (suffix: string) => `test:${suffix}`,
    getRuntimeStatus: () => runtime,
  } as unknown as RedisService;
}

test("memory presence deduplicates users and returns affected rooms on disconnect", async () => {
  const presence = new RoomPresenceService(createRedisFacade(null));
  await presence.connect("socket-a1", "user-a");
  await presence.connect("socket-a2", "user-a");
  await presence.connect("socket-b", "user-b");
  await presence.join("socket-a1", "room-1");
  await presence.join("socket-a2", "room-1");
  await presence.join("socket-b", "room-1");

  assert.deepEqual(new Set(await presence.getOnlineUserIds("room-1")), new Set(["user-a", "user-b"]));
  assert.equal(await presence.getOnlineUserCount(), 2);
  assert.deepEqual(await presence.disconnect("socket-b"), ["room-1"]);
  assert.deepEqual(await presence.getOnlineUserIds("room-1"), ["user-a"]);
});

test("redis presence is shared across service instances and prunes expired socket records", async () => {
  const redis = new FakeRedisClient();
  const first = new RoomPresenceService(createRedisFacade(redis));
  const second = new RoomPresenceService(createRedisFacade(redis));

  await first.connect("socket-a", "user-a");
  await first.join("socket-a", "room-1");
  await second.connect("socket-b", "user-b");
  await second.join("socket-b", "room-1");

  assert.deepEqual(new Set(await first.getOnlineUserIds("room-1")), new Set(["user-a", "user-b"]));
  assert.equal(await second.getOnlineUserCount(), 2);

  redis.strings.clear();
  assert.deepEqual(await first.getOnlineUserIds("room-1"), []);
  assert.equal(redis.sortedSet("test:presence:room:room-1").size, 0);
  assert.equal(redis.sortedSet("test:presence:online").size, 0);
});
