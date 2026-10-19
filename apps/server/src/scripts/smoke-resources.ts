import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000/api";
const credentialsPath = fileURLToPath(new URL("../../../../data/dev-admin-credentials.txt", import.meta.url));

const credentials = Object.fromEntries(
  (await readFile(credentialsPath, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
if (!credentials.username || !credentials.password) throw new Error("开发管理员凭据文件不完整，请先运行 db:seed:pglite");

const loginResponse = await fetch(`${baseUrl}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login: credentials.username, password: credentials.password }),
});
const session = await readJson<{ accessToken: string; user: { role: string } }>(loginResponse);
if (session.user.role !== "SUPER_ADMIN") throw new Error("开发账号不是超级管理员");
const authorization = { Authorization: `Bearer ${session.accessToken}` };

const fixtureTitle = "合成测试音 440Hz";
const wave = createSineWave(2, 440, 8_000);
const expectedWaveHash = createHash("sha256").update(Buffer.from(wave)).digest("hex");
type ImportedFixture = {
  jobId: string;
  song: { id: string; title: string; audio?: { sha256: string } };
};
const existingResponse = await fetch(`${baseUrl}/admin/songs?q=${encodeURIComponent(fixtureTitle)}`, { headers: authorization });
const existing = await readJson<{ items: ImportedFixture["song"][] }>(existingResponse);
const reusable = existing.items.find((song) => song.title === fixtureTitle && song.audio?.sha256 === expectedWaveHash);

let imported: ImportedFixture;
if (reusable) {
  imported = { jobId: "existing-fixture", song: reusable };
} else {
  const form = new FormData();
  form.set("title", fixtureTitle);
  form.set("artist", "Online KTV Test Generator");
  form.set("album", "Development Fixtures");
  form.set("durationMs", "2000");
  form.set("copyrightNote", "由项目烟雾测试即时生成的正弦波与原创测试歌词，仅用于开发联调");
  form.set("rightsConfirmed", "true");
  form.set("audio", new Blob([wave], { type: "audio/wav" }), "synthetic-tone.wav");
  form.set("lyric", new Blob(["[00:00.00]合成测试音\n[00:01.00]资源同步校验\n"], { type: "text/plain" }), "synthetic-tone.lrc");

  const importResponse = await fetch(`${baseUrl}/admin/songs/import`, {
    method: "POST",
    headers: authorization,
    body: form,
  });
  imported = await readJson<ImportedFixture>(importResponse);
}
if (imported.song.audio?.sha256 !== expectedWaveHash) throw new Error("服务端保存的音频哈希与源数据不一致");

const manifestResponse = await fetch(`${baseUrl}/songs/${imported.song.id}/manifest`, { headers: authorization });
const manifest = await readJson<{
  audio: { downloadUrl: string; sha256: string; sizeBytes: number };
  lyric?: { downloadUrl: string; sha256: string };
}>(manifestResponse);
const audioUrl = new URL(manifest.audio.downloadUrl, baseUrl).toString();
const downloadResponse = await fetch(audioUrl, { headers: authorization });
if (!downloadResponse.ok) throw new Error(`完整资源下载失败：HTTP ${downloadResponse.status}`);
const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
const downloadedHash = createHash("sha256").update(downloaded).digest("hex");
if (downloadedHash !== manifest.audio.sha256 || downloadedHash !== expectedWaveHash) {
  throw new Error("下载后的 SHA-256 校验失败");
}

const rangeResponse = await fetch(audioUrl, { headers: { ...authorization, Range: "bytes=0-15" } });
const rangeBytes = Buffer.from(await rangeResponse.arrayBuffer());
if (rangeResponse.status !== 206 || rangeBytes.length !== 16) throw new Error("HTTP Range 下载验证失败");

console.info(JSON.stringify({
  ok: true,
  role: session.user.role,
  songId: imported.song.id,
  jobId: imported.jobId,
  audioBytes: downloaded.length,
  sha256Verified: true,
  rangeVerified: true,
}));

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data ? String(data.message) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function createSineWave(durationSeconds: number, frequency: number, sampleRate: number): ArrayBuffer {
  const sampleCount = durationSeconds * sampleRate;
  const dataLength = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.15 * 32_767);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
