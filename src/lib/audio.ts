import { existsSync, readdirSync, renameSync, rmSync } from "fs";
import { extname, join } from "path";
import { tmpdir } from "os";
import { DOWNLOADS_DIR } from "@/config/paths";
import { checkFfmpeg } from "@/lib/ytdlp";
import Logger from "@/lib/logger";

const logger = new Logger("AUDIO");

const AUDIO_EXTS = new Set([
  ".mp3",
  ".mp4",
  ".m4a",
  ".webm",
  ".flac",
  ".wav",
  ".ogg",
  ".aac",
]);

export function isAudioFile(file: string): boolean {
  return AUDIO_EXTS.has(extname(file).toLowerCase());
}

export function getPlaylistAudioFiles(
  playlistName: string,
  indices?: number[],
): { index: number; file: string }[] {
  const dir = join(DOWNLOADS_DIR, playlistName);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter(isAudioFile)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  if (indices && indices.length) {
    const unique = Array.from(new Set(indices)).sort((a, b) => a - b);
    return unique
      .filter((i) => files[i] !== undefined)
      .map((i) => ({ index: i, file: files[i]! }));
  }

  return files.map((file, index) => ({ index, file }));
}

async function runFfmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(args);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`FFmpeg failed (exit ${code})`);
}

function codecArgs(file: string, normalize: boolean, bitrate?: string): string[] {
  const ext = extname(file).toLowerCase();
  if (ext === ".mp3") {
    return ["-c:a", "libmp3lame", normalize ? "-qscale:a" : "-b:a", normalize ? "2" : bitrate || "128k"];
  }
  if (ext === ".m4a" || ext === ".mp4" || ext === ".aac") {
    return ["-c:a", "aac", "-b:a", bitrate || "192k"];
  }
  return ["-c:a", "copy"];
}

export async function compressFile(
  dir: string,
  file: string,
  bitrate = "128k",
): Promise<void> {
  const input = join(dir, file);
  const tmpFile = join(
    tmpdir(),
    `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${extname(file)}`,
  );

  try {
    await runFfmpeg([
      "ffmpeg",
      "-i",
      input,
      ...codecArgs(file, false, bitrate),
      "-y",
      tmpFile,
    ]);
    renameSync(tmpFile, input);
    logger.log(`compressed ${file} -> ${bitrate}`);
  } finally {
    rmSync(tmpFile, { force: true });
  }
}

export async function normalizeFile(dir: string, file: string): Promise<void> {
  const input = join(dir, file);
  const tmpFile = join(
    tmpdir(),
    `nrm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${extname(file)}`,
  );

  try {
    await runFfmpeg([
      "ffmpeg",
      "-i",
      input,
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
      ...codecArgs(file, true),
      "-y",
      tmpFile,
    ]);
    renameSync(tmpFile, input);
    logger.log(`normalized ${file}`);
  } finally {
    rmSync(tmpFile, { force: true });
  }
}
