import assert from "node:assert/strict";
import test from "node:test";
import { RedisService } from "./redis.service.js";

async function withRedisEnvironment(
  values: { url?: string; required?: string },
  run: () => Promise<void>,
): Promise<void> {
  const previousUrl = process.env.REDIS_URL;
  const previousRequired = process.env.REDIS_REQUIRED;
  if (values.url === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = values.url;
  if (values.required === undefined) delete process.env.REDIS_REQUIRED;
  else process.env.REDIS_REQUIRED = values.required;
  try {
    await run();
  } finally {
    if (previousUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousUrl;
    if (previousRequired === undefined) delete process.env.REDIS_REQUIRED;
    else process.env.REDIS_REQUIRED = previousRequired;
  }
}

test("memory Redis mode remains a healthy single-instance runtime", async () => {
  await withRedisEnvironment({ url: "memory://", required: "false" }, async () => {
    const redis = new RedisService();
    assert.equal(await redis.connect(), false);
    assert.deepEqual(redis.getRuntimeStatus(), {
      mode: "single-instance",
      redis: "disabled",
      presenceStore: "memory",
      socketAdapter: "local",
    });
    await redis.onModuleDestroy();
  });
});

test("required Redis mode rejects a missing endpoint", async () => {
  await withRedisEnvironment({ required: "true" }, async () => {
    const redis = new RedisService();
    await assert.rejects(redis.connect(), /REDIS_REQUIRED=true/);
    await redis.onModuleDestroy();
  });
});
