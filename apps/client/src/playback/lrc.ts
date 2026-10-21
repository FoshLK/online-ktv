export interface LyricLine {
  timeMs: number;
  text: string;
}

const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(content: string): LyricLine[] {
  const offset = readOffset(content);
  const parsed: LyricLine[] = [];

  for (const rawLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timestampPattern)];
    if (matches.length === 0) continue;
    const text = rawLine.replace(timestampPattern, "").trim() || "♪";

    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (seconds >= 60) continue;
      const fraction = match[3] ?? "0";
      const fractionMs = fraction.length === 1
        ? Number(fraction) * 100
        : fraction.length === 2
          ? Number(fraction) * 10
          : Number(fraction.slice(0, 3).padEnd(3, "0"));
      parsed.push({
        timeMs: Math.max(0, minutes * 60_000 + seconds * 1_000 + fractionMs + offset),
        text,
      });
    }
  }

  parsed.sort((left, right) => left.timeMs - right.timeMs);
  return parsed.filter((line, index) => {
    const previous = parsed[index - 1];
    return !previous || previous.timeMs !== line.timeMs || previous.text !== line.text;
  });
}

export function activeLyricIndex(lines: LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle]!.timeMs <= positionMs) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function readOffset(content: string): number {
  const match = /^\s*\[offset:([+-]?\d+)\]\s*$/im.exec(content);
  return match ? Number(match[1]) : 0;
}
