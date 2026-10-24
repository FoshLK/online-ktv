import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import type { RoomPresenceService } from "../rooms/room-presence.service.js";
import type { RoomsService } from "../rooms/rooms.service.js";
import { AdminService } from "./admin.service.js";

test("import job history returns operator and song metadata with pagination", async () => {
  const createdAt = new Date("2026-10-22T08:00:00.000Z");
  const finishedAt = new Date("2026-10-22T08:00:04.000Z");
  const prisma = {
    songImportJob: {
      findMany: async () => [{
        id: "job-1",
        status: "COMPLETED",
        progress: 100,
        sourceType: "ADMIN_UPLOAD",
        sourceLabel: "demo.mp3",
        errorCode: null,
        errorDetail: null,
        createdAt,
        startedAt: createdAt,
        finishedAt,
        creator: { id: "admin-1", username: "operator" },
        song: { id: "song-1", title: "测试歌曲", artist: "测试歌手" },
      }],
      count: async () => 1,
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  } as unknown as PrismaService;
  const service = new AdminService(prisma, {} as RoomsService, {} as RoomPresenceService);

  const result = await service.listImportJobs({ q: "测试", page: 1, pageSize: 50 });

  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.status, "COMPLETED");
  assert.equal(result.items[0]?.creator.username, "operator");
  assert.equal(result.items[0]?.song?.title, "测试歌曲");
  assert.equal(result.items[0]?.finishedAt, finishedAt.toISOString());
});

test("playback history reports the frozen participant readiness totals", async () => {
  const createdAt = new Date("2026-10-22T09:00:00.000Z");
  const prisma = {
    playbackSession: {
      findMany: async () => [{
        id: "playback-1",
        roomId: "room-1",
        status: "ENDED",
        sequence: 4,
        assetVersion: 2,
        startAt: new Date("2026-10-22T09:00:03.000Z"),
        createdAt,
        updatedAt: new Date("2026-10-22T09:03:00.000Z"),
        endedAt: new Date("2026-10-22T09:03:00.000Z"),
        room: { name: "朋友练歌房" },
        song: {
          id: "song-1",
          title: "测试歌曲",
          artist: "测试歌手",
          durationMs: 180_000,
          status: "PUBLISHED",
          assetVersion: 2,
        },
        readyStates: [{ readyAt: createdAt }, { readyAt: null }],
      }],
      count: async () => 1,
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  } as unknown as PrismaService;
  const service = new AdminService(prisma, {} as RoomsService, {} as RoomPresenceService);

  const result = await service.listPlaybackHistory({ q: "", page: 1, pageSize: 50 });

  assert.equal(result.items[0]?.participantCount, 2);
  assert.equal(result.items[0]?.readyCount, 1);
  assert.equal(result.items[0]?.roomName, "朋友练歌房");
  assert.equal(result.items[0]?.state, "ENDED");
});
