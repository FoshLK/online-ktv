import assert from "node:assert/strict";
import test from "node:test";
import type { CurrentUser, PlaybackStatus } from "@ktv/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import { PlaybackService } from "./playback.service.js";

const owner: CurrentUser = {
  id: "00000000-0000-0000-0000-000000000001",
  username: "owner",
  email: "owner@example.com",
  emailVerified: true,
  role: "USER",
  status: "ACTIVE",
};

const memberId = "00000000-0000-0000-0000-000000000002";
const roomId = "00000000-0000-0000-0000-000000000010";
const songId = "00000000-0000-0000-0000-000000000020";
const sessionId = "00000000-0000-0000-0000-000000000030";
const checksum = "a".repeat(64);

test("prepare freezes the current room members as playback participants", async () => {
  let createData: Record<string, unknown> | undefined;
  const session = playbackRecord();
  const prisma = {
    room: {
      findUnique: async () => ({
        id: roomId,
        ownerId: owner.id,
        status: "OPEN",
        members: [
          { userId: owner.id, role: "OWNER" },
          { userId: memberId, role: "MEMBER" },
        ],
        playbacks: [],
      }),
    },
    song: {
      findUnique: async () => ({
        id: songId,
        status: "PUBLISHED",
        assets: [{ version: 3, sha256: checksum }],
      }),
    },
    playbackSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createData = data;
        return session;
      },
    },
  } as unknown as PrismaService;

  const snapshot = await new PlaybackService(prisma).prepare(roomId, songId, owner);
  const participants = (createData?.readyStates as { create: Array<{ userId: string }> }).create;

  assert.deepEqual(participants.map((item) => item.userId), [owner.id, memberId]);
  assert.equal(createData?.expectedChecksum, checksum);
  assert.equal(snapshot.waitingUserIds.length, 2);
});

test("the last ready participant schedules one shared START command", async () => {
  const session = playbackRecord();
  let roomMarkedPlaying = false;
  const transaction = {
    playbackSession: {
      findUnique: async () => session,
      findUniqueOrThrow: async () => session,
      update: async ({ data }: { data: {
        status: "SCHEDULED";
        sequence: { increment: number };
        startAt: Date;
        pausedPositionMs: number;
      } }) => {
        session.status = data.status;
        session.sequence += data.sequence.increment;
        session.startAt = data.startAt;
        session.pausedPositionMs = data.pausedPositionMs;
        return session;
      },
    },
    playbackReadyState: {
      update: async ({ where, data }: {
        where: { playbackSessionId_userId: { userId: string } };
        data: { checksum: string; readyAt: Date };
      }) => {
        const participant = session.readyStates.find((state) => state.userId === where.playbackSessionId_userId.userId);
        if (participant) Object.assign(participant, data);
        return participant;
      },
    },
    room: {
      update: async () => {
        roomMarkedPlaying = true;
        return {};
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof transaction) => unknown) => callback(transaction),
  } as unknown as PrismaService;
  const service = new PlaybackService(prisma);

  const first = await service.markReady(sessionId, owner.id, checksum);
  assert.equal(first.command, undefined);
  assert.equal(first.snapshot.state, "PREPARING");
  assert.deepEqual(first.snapshot.waitingUserIds, [memberId]);

  const last = await service.markReady(sessionId, memberId, checksum);
  assert.equal(last.snapshot.state, "SCHEDULED");
  assert.equal(last.snapshot.sequence, 1);
  assert.equal(last.command?.action, "START");
  assert.equal(last.command?.sessionId, sessionId);
  assert.equal(last.command?.roomId, roomId);
  assert.equal(last.command?.positionMs, 0);
  assert.equal(roomMarkedPlaying, true);
  assert.ok((last.command?.effectiveAtServerMs ?? 0) > Date.now());
});

test("position reports with an old sequence are rejected", async () => {
  let participantRead = false;
  const prisma = {
    playbackSession: {
      findUnique: async () => ({ sequence: 5, status: "PLAYING" }),
    },
    playbackReadyState: {
      findUnique: async () => {
        participantRead = true;
        return { readyAt: new Date() };
      },
    },
  } as unknown as PrismaService;

  const result = await new PlaybackService(prisma).reportPosition(sessionId, owner.id, 4, 1_000, Date.now());

  assert.equal(result.accepted, false);
  assert.equal(participantRead, false);
});

test("pause derives the authoritative position from the server timeline", async () => {
  const session = playbackRecord();
  session.status = "SCHEDULED";
  session.sequence = 4;
  session.startAt = new Date(Date.now() - 5_000);
  session.pausedPositionMs = 1_000;
  let persistedPosition = -1;

  const prisma = {
    room: {
      findUnique: async () => ({
        id: roomId,
        ownerId: owner.id,
        status: "PLAYING",
        members: [{ userId: owner.id, role: "OWNER" }],
      }),
    },
    playbackSession: {
      findFirst: async () => session,
      update: async ({ data }: { data: {
        status: "PAUSED";
        sequence: { increment: number };
        startAt: null;
        pausedPositionMs: number;
      } }) => {
        persistedPosition = data.pausedPositionMs;
        session.status = data.status;
        session.sequence += data.sequence.increment;
        session.startAt = data.startAt;
        session.pausedPositionMs = data.pausedPositionMs;
        return session;
      },
    },
  } as unknown as PrismaService;

  const transition = await new PlaybackService(prisma).control(roomId, { action: "PAUSE" }, owner);

  assert.ok(persistedPosition >= 6_700 && persistedPosition <= 7_000);
  assert.equal(transition.snapshot.state, "PAUSED");
  assert.equal(transition.command?.sessionId, sessionId);
  assert.equal(transition.command?.roomId, roomId);
  assert.equal(transition.command?.positionMs, persistedPosition);
});

function playbackRecord() {
  return {
    id: sessionId,
    roomId,
    status: "PREPARING" as PlaybackStatus,
    sequence: 0,
    assetVersion: 3,
    expectedChecksum: checksum,
    startAt: null as Date | null,
    pausedPositionMs: null as number | null,
    song: {
      id: songId,
      title: "测试歌曲",
      artist: "测试歌手",
      durationMs: 180_000,
      status: "PUBLISHED" as const,
      assetVersion: 3,
    },
    readyStates: [
      { userId: owner.id, checksum: null as string | null, readyAt: null as Date | null },
      { userId: memberId, checksum: null as string | null, readyAt: null as Date | null },
    ],
  };
}
