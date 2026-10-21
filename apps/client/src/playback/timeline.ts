import type { PlaybackSnapshot } from "@ktv/contracts";

export interface DriftCorrection {
  driftMs: number;
  playbackRate: number;
  seekToMs?: number;
}

export function expectedPositionMs(snapshot: PlaybackSnapshot, serverNowMs: number): number {
  const basePosition = snapshot.pausedPositionMs ?? 0;
  if (!(snapshot.state === "SCHEDULED" || snapshot.state === "PLAYING") || snapshot.startAtServerMs === undefined) {
    return clampPosition(basePosition, snapshot.song.durationMs);
  }

  const elapsed = Math.max(0, serverNowMs - snapshot.startAtServerMs);
  return clampPosition(basePosition + elapsed, snapshot.song.durationMs);
}

export function isTimelinePlaying(snapshot: PlaybackSnapshot, serverNowMs: number): boolean {
  return (snapshot.state === "SCHEDULED" || snapshot.state === "PLAYING")
    && snapshot.startAtServerMs !== undefined
    && serverNowMs >= snapshot.startAtServerMs
    && expectedPositionMs(snapshot, serverNowMs) < snapshot.song.durationMs;
}

export function getDriftCorrection(expectedMs: number, actualMs: number): DriftCorrection {
  const driftMs = expectedMs - actualMs;
  const absoluteDrift = Math.abs(driftMs);

  if (absoluteDrift >= 250) {
    return { driftMs, playbackRate: 1, seekToMs: Math.max(0, expectedMs) };
  }
  if (absoluteDrift >= 45) {
    return {
      driftMs,
      playbackRate: Math.min(1.03, Math.max(0.97, 1 + driftMs / 4_000)),
    };
  }
  return { driftMs, playbackRate: 1 };
}

function clampPosition(positionMs: number, durationMs: number): number {
  return Math.min(Math.max(0, positionMs), Math.max(0, durationMs));
}
