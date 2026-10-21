import { convertFileSrc } from "@tauri-apps/api/core";
import type { PlaybackCommand, PlaybackControlRequest, PlaybackSnapshot, RoomDetails } from "@ktv/contracts";
import { StatusBadge } from "@ktv/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeLyricIndex, parseLrc, type LyricLine } from "./lrc";
import { expectedPositionMs, getDriftCorrection, isTimelinePlaying } from "./timeline";

export interface CachedPlaybackAssets {
  sessionId: string;
  audioPath: string;
  lyricPath?: string;
}

interface SynchronizedPlayerProps {
  room: RoomDetails | null;
  assets?: CachedPlaybackAssets;
  command: PlaybackCommand | null;
  clockOffsetMs: number | null;
  canControl: boolean;
  controlBusy: boolean;
  onControl: (action: PlaybackControlRequest["action"], positionMs?: number) => Promise<void>;
  onReport: (snapshot: PlaybackSnapshot, positionMs: number) => void;
  onEnded: (snapshot: PlaybackSnapshot) => void;
}

type PlayerState = "idle" | "downloading" | "buffering" | "scheduled" | "playing" | "paused" | "ended" | "error";

export function SynchronizedPlayer({
  room,
  assets,
  command,
  clockOffsetMs,
  canControl,
  controlBusy,
  onControl,
  onReport,
  onEnded,
}: SynchronizedPlayerProps) {
  const snapshot = room?.currentPlayback;
  const song = snapshot?.song;
  const audioRef = useRef<HTMLAudioElement>(null);
  const endedSessionRef = useRef<string | null>(null);
  const lastCorrectionAtRef = useRef(0);
  const lastReportAtRef = useRef(0);
  const [mediaReady, setMediaReady] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [positionMs, setPositionMs] = useState(0);
  const [driftMs, setDriftMs] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [playerError, setPlayerError] = useState("");
  const [needsSoundUnlock, setNeedsSoundUnlock] = useState(false);
  const [seekPreviewMs, setSeekPreviewMs] = useState<number | null>(null);
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem("ktv-client:volume") ?? 85);
    return Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : 85;
  });

  const matchingAssets = assets?.sessionId === snapshot?.sessionId ? assets : undefined;
  const audioUrl = useMemo(
    () => matchingAssets ? convertFileSrc(matchingAssets.audioPath) : undefined,
    [matchingAssets?.audioPath],
  );

  useEffect(() => {
    endedSessionRef.current = null;
    setMediaReady(false);
    setPlayerError("");
    setNeedsSoundUnlock(false);
    setDriftMs(null);
    setPlaybackRate(1);
    setSeekPreviewMs(null);
    setPositionMs(snapshot?.pausedPositionMs ?? 0);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.playbackRate = 1;
      audio.load();
    }
  }, [audioUrl, snapshot?.sessionId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume / 100;
    localStorage.setItem("ktv-client:volume", String(volume));
  }, [volume]);

  useEffect(() => {
    const lyricPath = matchingAssets?.lyricPath;
    if (!lyricPath) {
      setLyrics([]);
      return;
    }

    const controller = new AbortController();
    void fetch(convertFileSrc(lyricPath), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((content) => setLyrics(parseLrc(content)))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLyrics([]);
        setPlayerError(`歌词读取失败：${error instanceof Error ? error.message : String(error)}`);
      });
    return () => controller.abort();
  }, [matchingAssets?.lyricPath]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !snapshot || !matchingAssets || !mediaReady || clockOffsetMs === null) {
      if (!snapshot) setPlayerState("idle");
      else if (!matchingAssets) setPlayerState("downloading");
      else setPlayerState("buffering");
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    const offset = clockOffsetMs ?? 0;
    const serverNow = () => Date.now() + offset;
    const clamp = (value: number) => Math.min(Math.max(0, value), snapshot.song.durationMs);
    const setAudioPosition = (value: number) => {
      const next = clamp(value);
      if (Number.isFinite(audio.duration) && Math.abs(audio.currentTime * 1_000 - next) > 10) {
        audio.currentTime = next / 1_000;
      }
      setPositionMs(next);
    };
    const attemptPlay = (basePositionMs: number, effectiveAtServerMs: number) => {
      if (cancelled) return;
      const desiredPosition = clamp(basePositionMs + Math.max(0, serverNow() - effectiveAtServerMs));
      setAudioPosition(desiredPosition);
      audio.playbackRate = 1;
      setPlaybackRate(1);
      if (desiredPosition >= snapshot.song.durationMs) {
        audio.pause();
        setPlayerState("ended");
        return;
      }
      void audio.play().then(() => {
        if (cancelled) return;
        setPlayerState("playing");
        setNeedsSoundUnlock(false);
        setPlayerError("");
      }).catch((error: unknown) => {
        if (cancelled) return;
        setPlayerState("error");
        setNeedsSoundUnlock(true);
        setPlayerError(`系统阻止了自动播放：${error instanceof Error ? error.message : String(error)}`);
      });
    };
    const playAt = (basePositionMs: number, effectiveAtServerMs: number) => {
      const delay = effectiveAtServerMs - serverNow();
      if (delay > 15) {
        audio.pause();
        setAudioPosition(basePositionMs);
        setPlayerState("scheduled");
        timer = window.setTimeout(() => attemptPlay(basePositionMs, effectiveAtServerMs), delay);
      } else {
        attemptPlay(basePositionMs, effectiveAtServerMs);
      }
    };
    const pauseAt = (position: number, effectiveAtServerMs: number, state: PlayerState = "paused") => {
      const applyPause = () => {
        if (cancelled) return;
        audio.pause();
        audio.playbackRate = 1;
        setPlaybackRate(1);
        setAudioPosition(position);
        setPlayerState(state);
      };
      const delay = effectiveAtServerMs - serverNow();
      if (delay > 15) timer = window.setTimeout(applyPause, delay);
      else applyPause();
    };

    const matchingCommand = command?.sessionId === snapshot.sessionId && command.sequence === snapshot.sequence
      ? command
      : undefined;
    if (matchingCommand) {
      const commandPosition = matchingCommand.positionMs ?? snapshot.pausedPositionMs ?? 0;
      if (matchingCommand.action === "START" || matchingCommand.action === "RESUME") {
        playAt(commandPosition, matchingCommand.effectiveAtServerMs);
      } else if (matchingCommand.action === "SEEK") {
        if (snapshot.state === "PAUSED") pauseAt(commandPosition, matchingCommand.effectiveAtServerMs);
        else playAt(commandPosition, matchingCommand.effectiveAtServerMs);
      } else if (matchingCommand.action === "PAUSE") {
        pauseAt(commandPosition, matchingCommand.effectiveAtServerMs);
      } else {
        pauseAt(0, matchingCommand.effectiveAtServerMs, "ended");
      }
    } else if (snapshot.state === "PREPARING") {
      audio.pause();
      setAudioPosition(0);
      setPlayerState("buffering");
    } else if (snapshot.state === "PAUSED") {
      pauseAt(snapshot.pausedPositionMs ?? 0, serverNow());
    } else if (snapshot.state === "SCHEDULED" || snapshot.state === "PLAYING") {
      if (snapshot.startAtServerMs === undefined) {
        setPlayerState("error");
        setPlayerError("播放时间轴缺少服务器开始时间");
      } else {
        playAt(snapshot.pausedPositionMs ?? 0, snapshot.startAtServerMs);
      }
    } else {
      pauseAt(0, serverNow(), snapshot.state === "ENDED" ? "ended" : "error");
    }

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    matchingAssets,
    mediaReady,
    clockOffsetMs,
    command,
    snapshot?.sessionId,
    snapshot?.sequence,
    snapshot?.state,
    snapshot?.startAtServerMs,
    snapshot?.pausedPositionMs,
    snapshot?.song.durationMs,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !snapshot || !matchingAssets || !mediaReady) return;

    const interval = window.setInterval(() => {
      const now = Date.now();
      const serverNow = now + (clockOffsetMs ?? 0);
      const actualPosition = Math.max(0, audio.currentTime * 1_000);
      setPositionMs(actualPosition);

      if (!audio.paused && isTimelinePlaying(snapshot, serverNow) && now - lastCorrectionAtRef.current >= 1_000) {
        const expected = expectedPositionMs(snapshot, serverNow);
        const correction = getDriftCorrection(expected, actualPosition);
        if (correction.seekToMs !== undefined) audio.currentTime = correction.seekToMs / 1_000;
        audio.playbackRate = correction.playbackRate;
        setPlaybackRate(correction.playbackRate);
        setDriftMs(Math.round(correction.driftMs));
        lastCorrectionAtRef.current = now;
      } else if (audio.paused) {
        setPlaybackRate(1);
      }

      if (!audio.paused && now - lastReportAtRef.current >= 3_000) {
        onReport(snapshot, Math.round(audio.currentTime * 1_000));
        lastReportAtRef.current = now;
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [matchingAssets, mediaReady, clockOffsetMs, onReport, snapshot]);

  const displayedPosition = Math.min(seekPreviewMs ?? positionMs, song?.durationMs ?? 0);
  const lyricIndex = activeLyricIndex(lyrics, displayedPosition);
  const previousLyric = lyricIndex > 0 ? lyrics[lyricIndex - 1]?.text : undefined;
  const currentLyric = lyricIndex >= 0 ? lyrics[lyricIndex]?.text : lyrics[0]?.text;
  const nextLyric = lyricIndex >= 0 ? lyrics[lyricIndex + 1]?.text : lyrics[1]?.text;
  const canSeek = canControl && Boolean(snapshot) && snapshot?.state !== "PREPARING" && snapshot?.state !== "ENDED";
  const stateLabel = playerState === "playing" ? "演唱中"
    : playerState === "paused" ? "已暂停"
      : playerState === "scheduled" ? "等待统一开始"
        : playerState === "downloading" ? "下载资源中"
          : playerState === "buffering" ? "准备播放器"
            : playerState === "error" ? "播放异常"
              : playerState === "ended" ? "已结束"
                : "房间播放器";

  const commitSeek = () => {
    if (!canSeek || seekPreviewMs === null) return;
    const target = Math.round(seekPreviewMs);
    setSeekPreviewMs(null);
    void onControl("SEEK", target);
  };
  const unlockSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().then(() => {
      setNeedsSoundUnlock(false);
      setPlayerError("");
      setPlayerState("playing");
    }).catch((error: unknown) => setPlayerError(error instanceof Error ? error.message : String(error)));
  };

  return (
    <aside className="now-playing">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="auto"
        onCanPlay={() => setMediaReady(true)}
        onLoadedMetadata={() => setMediaReady(true)}
        onPlaying={() => setPlayerState("playing")}
        onPause={() => { if (snapshot?.state === "PAUSED") setPlayerState("paused"); }}
        onWaiting={() => setPlayerState("buffering")}
        onError={() => { setPlayerState("error"); setPlayerError("本地音频无法解码或读取"); }}
        onEnded={() => {
          setPlayerState("ended");
          setPositionMs(song?.durationMs ?? positionMs);
          if (snapshot && endedSessionRef.current !== snapshot.sessionId) {
            endedSessionRef.current = snapshot.sessionId;
            onEnded(snapshot);
          }
        }}
      />
      <div className={`vinyl${playerState === "playing" ? " spinning" : ""}`}><div>♫</div></div>
      <span className="eyebrow">{stateLabel}</span>
      <h2>{song?.title ?? "尚未点歌"}</h2>
      <p>{song?.artist ?? "进入房间后可查看播放队列"}</p>

      <div className="lyric-preview synced-lyrics">
        {previousLyric && <span>{previousLyric}</span>}
        <strong>{currentLyric ?? (snapshot?.state === "PREPARING" ? "正在等待全部成员下载歌曲" : "等待房主选择歌曲")}</strong>
        <span>{nextLyric ?? (lyrics.length === 0 && snapshot ? "当前歌曲没有可显示的 LRC 歌词" : "")}</span>
      </div>

      <input
        className="player-seek"
        type="range"
        min={0}
        max={song?.durationMs ?? 1}
        step={100}
        value={displayedPosition}
        disabled={!canSeek || controlBusy}
        aria-label="播放位置"
        onChange={(event) => setSeekPreviewMs(Number(event.target.value))}
        onPointerUp={commitSeek}
        onKeyUp={commitSeek}
      />
      <div className="progress-time"><span>{formatDuration(displayedPosition)}</span><span>{song ? formatDuration(song.durationMs) : "--:--"}</span></div>

      {snapshot && <div className="player-controls">
        <button disabled={!canSeek || controlBusy} onClick={() => void onControl("SEEK", Math.max(0, displayedPosition - 10_000))} type="button">−10</button>
        <button
          className="play-toggle"
          disabled={!canControl || controlBusy || snapshot.state === "PREPARING"}
          onClick={() => void onControl(snapshot.state === "PAUSED" ? "RESUME" : "PAUSE")}
          type="button"
        >{snapshot.state === "PAUSED" ? "▶" : "Ⅱ"}</button>
        <button disabled={!canSeek || controlBusy} onClick={() => void onControl("SEEK", Math.min(snapshot.song.durationMs, displayedPosition + 10_000))} type="button">+10</button>
        <button className="stop-control" disabled={!canControl || controlBusy} onClick={() => void onControl("STOP")} type="button">■</button>
      </div>}

      <label className="volume-control"><span>音量</span><input type="range" min={0} max={100} value={volume} onChange={(event) => setVolume(Number(event.target.value))} /><small>{volume}%</small></label>
      {needsSoundUnlock && <button className="sound-unlock" onClick={unlockSound} type="button">点击启用声音</button>}
      {playerError && <p className="player-error">{playerError}</p>}

      <div className="ready-state">
        <span>{driftMs === null ? "同步校正待命" : `漂移 ${driftMs >= 0 ? "+" : ""}${driftMs} ms · ${playbackRate.toFixed(3)}×`}</span>
        <StatusBadge tone={snapshot && snapshot.waitingUserIds.length === 0 ? "success" : "warning"}>
          {snapshot ? `${snapshot.readyUserIds.length} / ${snapshot.readyUserIds.length + snapshot.waitingUserIds.length} 已就绪` : "尚未开始"}
        </StatusBadge>
      </div>
    </aside>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
