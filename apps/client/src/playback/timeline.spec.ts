import assert from "node:assert/strict";
import test from "node:test";
import type { PlaybackSnapshot } from "@ktv/contracts";
import { expectedPositionMs, getDriftCorrection, isTimelinePlaying } from "./timeline";

const snapshot: PlaybackSnapshot = {
  sessionId: "session",
  roomId: "room",
  song: { id: "song", title: "Test", artist: "Test", durationMs: 180_000, status: "PUBLISHED", assetVersion: 1 },
  state: "SCHEDULED",
  sequence: 1,
  assetVersion: 1,
  expectedChecksum: "a".repeat(64),
  startAtServerMs: 10_000,
  pausedPositionMs: 5_000,
  readyUserIds: [],
  waitingUserIds: [],
};

test("authoritative position includes the resume base and elapsed server time", () => {
  assert.equal(expectedPositionMs(snapshot, 12_500), 7_500);
  assert.equal(expectedPositionMs(snapshot, 9_000), 5_000);
  assert.equal(isTimelinePlaying(snapshot, 9_999), false);
  assert.equal(isTimelinePlaying(snapshot, 10_001), true);
});

test("large drift seeks while small drift changes playback rate", () => {
  assert.deepEqual(getDriftCorrection(10_000, 9_600), { driftMs: 400, playbackRate: 1, seekToMs: 10_000 });
  assert.deepEqual(getDriftCorrection(10_000, 9_900), { driftMs: 100, playbackRate: 1.025 });
  assert.deepEqual(getDriftCorrection(10_000, 9_980), { driftMs: 20, playbackRate: 1 });
});
