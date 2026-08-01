import type {
  SearchResult,
  MetadataResult,
  PlaylistImportResult,
} from "@/types";
import {
  parseYoutubeTitle,
  parseProgressLine,
  getCookieBrowserTargets,
} from "@/lib/utils";
import {
  EXTRACTOR_ARGS,
  USER_AGENT,
  BGUTIL_GENERATE_ONCE,
} from "@/config/paths";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "fs";
import { extname, join } from "path";
import { tmpdir } from "os";
import Logger from "@/lib/logger";

let _ytdlpPath: string | null = null;
const logger = new Logger("YT-DLP");

let _pythonPath: string | null = null;

export function getPythonBinary(): string {
  if (_pythonPath) return _pythonPath;

  const ytBin = ensureYtdlpBinary();
  if (ytBin.includes("-m yt_dlp")) {
    _pythonPath = ytBin.split(" ")[0]!;
    logger.log(`using python: ${_pythonPath}`);
    return _pythonPath;
  }

  for (const cmd of ["python", "python3", "py"]) {
    try {
      const proc = Bun.spawnSync([cmd, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (proc.exitCode === 0) {
        _pythonPath = cmd;
        logger.log(`found python: ${_pythonPath}`);
        return _pythonPath;
      }
    } catch {
      logger.warn(`python check failed`);
    }
  }

  _pythonPath = "python";
  logger.warn(`python not found, using fallback: ${_pythonPath}`);
  return _pythonPath;
}

function ensureYtdlpBinary(): string {
  if (_ytdlpPath) return _ytdlpPath;

  try {
    const proc = Bun.spawnSync(["where", "yt-dlp"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode === 0) {
      const line = proc.stdout.toString().trim().split("\n")[0]?.trim();
      if (line) {
        _ytdlpPath = line;
        logger.log(`found in PATH: ${_ytdlpPath}`);
        return _ytdlpPath;
      }
    }
  } catch {
    logger.warn(`where yt-dlp failed`);
  }

  const candidates = [
    "C:\\Users\\Kocherga\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\yt-dlp.exe",
    "C:\\Users\\Kocherga\\AppData\\Local\\Programs\\Python\\Python311\\Scripts\\yt-dlp.exe",
    "C:\\Users\\Kocherga\\AppData\\Local\\Programs\\Python\\Python310\\Scripts\\yt-dlp.exe",
    "C:\\Users\\Kocherga\\AppData\\Local\\pipx\\venvs\\yt-dlp\\Scripts\\yt-dlp.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      _ytdlpPath = c;
      logger.log(`found at: ${_ytdlpPath}`);
      return _ytdlpPath;
    }
  }

  try {
    for (const cmd of ["python", "python3", "py"]) {
      const proc = Bun.spawnSync([cmd, "-m", "yt_dlp", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (proc.exitCode === 0) {
        _ytdlpPath = `${cmd} -m yt_dlp`;
        const ver = proc.stdout.toString().trim();
        logger.log(`found via: ${_ytdlpPath} (v${ver})`);
        return _ytdlpPath;
      }
    }
  } catch {
    logger.debug(`python -m yt_dlp not available for this command`);
  }

  _ytdlpPath = "yt-dlp";
  logger.warn(`not found, using fallback: ${_ytdlpPath}`);
  return "yt-dlp";
}

// ── FFmpeg detection & conversion ──────────────────────────────────

let _ffmpegChecked = false;
let _ffmpegAvailable = false;

export async function checkFfmpeg(): Promise<boolean> {
  if (_ffmpegChecked) return _ffmpegAvailable;
  _ffmpegChecked = true;
  try {
    const proc = Bun.spawnSync(["ffmpeg", "-version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    _ffmpegAvailable = proc.exitCode === 0;
  } catch {
    _ffmpegAvailable = false;
  }
  return _ffmpegAvailable;
}

async function convertToMp3(
  input: string,
  output: string,
  thumbnail?: string,
): Promise<void> {
  const args: string[] = [
    "ffmpeg",
    "-i",
    input,
    "-vn",
    "-c:a",
    "libmp3lame",
    "-qscale:a",
    "2",
    "-id3v2_version",
    "3",
    "-y",
    output,
  ];
  if (thumbnail) {
    args.splice(3, 0, "-i", thumbnail, "-map", "0:a", "-map", "1");
    args.splice(
      args.length - 2,
      0,
      "-metadata:s:v",
      "title=Cover",
      "-metadata:s:v",
      "comment=Cover (front)",
    );
  }
  const proc = Bun.spawn(args);
  const code = await proc.exited;
  if (code !== 0) throw new Error("FFmpeg MP3 conversion failed");
}

async function convertToMp4(
  input: string,
  output: string,
  thumbnail?: string,
): Promise<void> {
  const args: string[] = [
    "ffmpeg",
    "-i",
    input,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-y",
    output,
  ];
  if (thumbnail) {
    args.splice(3, 0, "-i", thumbnail);
    args.splice(
      7,
      0,
      "-map",
      "0",
      "-map",
      "1",
      "-disposition:v:1",
      "attached_pic",
    );
  }
  const proc = Bun.spawn(args);
  const code = await proc.exited;
  if (code !== 0) throw new Error("FFmpeg MP4 conversion failed");
}

function findThumbnail(dir: string): string | undefined {
  for (const f of readdirSync(dir)) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(f)) return join(dir, f);
  }
}

// ── yt-dlp subprocess helpers ──────────────────────────────────────

function extractorArgsCli(poTokenArg?: string): string {
  let args = "";
  if (poTokenArg) args += poTokenArg;
  const entries = Object.entries(EXTRACTOR_ARGS);
  const rest = entries
    .map(([site, opts]) => {
      const parts = Object.entries(opts).map(([k, v]) => `${k}=${v.join(",")}`);
      return `${site}:${parts.join(";")}`;
    })
    .join(" ");
  if (!args) return rest;
  return rest ? `${args} ${rest}` : args;
}

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return match?.[1] ?? null;
}

async function generatePoToken(videoId: string): Promise<string | null> {
  if (!existsSync(BGUTIL_GENERATE_ONCE)) {
    logger.warn(`[pot] generate_once.js not found at ${BGUTIL_GENERATE_ONCE}`);
    return null;
  }
  try {
    const proc = Bun.spawn(
      ["node", BGUTIL_GENERATE_ONCE, "-c", videoId, "--verbose"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const { stdout, stderr, exitCode } = await collectOutput(proc);
    if (exitCode !== 0) {
      logger.warn(`[pot] generate_once.js failed: ${stderr.slice(0, 200)}`);
      return null;
    }
    const lines = stdout.trim().split("\n").filter(Boolean);
    const jsonLine = lines[lines.length - 1]!;
    const data = JSON.parse(jsonLine);
    if (!data.poToken) {
      logger.warn(`[pot] no poToken in response`);
      return null;
    }
    const poToken = data.poToken as string;
    logger.log(`[pot] generated PO token: ${poToken.slice(0, 20)}...`);
    return poToken;
  } catch (e) {
    logger.warn(`[pot] generation failed: ${e}`);
    return null;
  }
}

export function ytdlp(
  args: string[],
  opts?: { timeout?: number; env?: Record<string, string>; poToken?: string },
): Bun.Subprocess {
  const binary = ensureYtdlpBinary();
  const poTokenArg = opts?.poToken
    ? `youtube:po_token=WEB.gvs+${opts.poToken}`
    : undefined;
  const fullArgs: string[] = [
    ...binary.split(" "),
    ...args,
    "--js-runtimes",
    "bun",
    "--extractor-args",
    extractorArgsCli(poTokenArg),
    "--user-agent",
    USER_AGENT,
  ];
  if (opts?.timeout) fullArgs.push("--socket-timeout", String(opts.timeout));
  return Bun.spawn(fullArgs, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts?.env },
  });
}

export function trySpawnYtdlp(
  args: string[],
  poToken?: string,
): Bun.Subprocess | null {
  try {
    return ytdlp(args, poToken ? { poToken } : undefined);
  } catch {
    return null;
  }
}

async function collectOutput(
  proc: Bun.Subprocess,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function safeExecYtdlp(
  args: string[],
  poToken?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const proc = ytdlp(args, poToken ? { poToken } : undefined);
    return await collectOutput(proc);
  } catch (e) {
    return { stdout: "", stderr: String(e), exitCode: 1 };
  }
}

export async function searchYoutube(
  query: string,
  maxResults = 8,
): Promise<SearchResult[]> {
  const { stdout, exitCode } = await safeExecYtdlp([
    `ytsearch${maxResults}:${query}`,
    "--dump-json",
    "--flat-playlist",
    "--no-warnings",
    "--quiet",
  ]);
  if (exitCode !== 0) {
    logger.warn(`[search] yt-dlp exited with code ${exitCode}`);
    return [];
  }

  const results = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const e = JSON.parse(line);
        const videoId = String(e.id || "");
        return {
          id: videoId,
          title: String(e.title || "Unknown"),
          channel: String(e.channel || e.uploader || "Unknown"),
          duration: e.duration ?? null,
          thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is SearchResult => r !== null);

  logger.log(`[search] ${results.length} results for "${query}"`);
  return results;
}

export async function getVideoMetadata(url: string): Promise<MetadataResult> {
  const { stdout, exitCode } = await safeExecYtdlp([
    url,
    "--dump-json",
    "--no-warnings",
    "--quiet",
  ]);
  if (exitCode !== 0 || !stdout.trim()) {
    throw new Error("Failed to fetch metadata");
  }

  const info = JSON.parse(stdout.trim().split("\n")[0]!);
  const rawTitle = String(info.title || "");
  const parsed = parseYoutubeTitle(rawTitle);
  const infoId = String(info.id || "");

  return {
    ...parsed,
    duration: info.duration ?? null,
    channel: String(info.channel || info.uploader || ""),
    id: infoId,
    thumbnail: `https://img.youtube.com/vi/${infoId}/hqdefault.jpg`,
  };
}

async function spawnAndMonitor(
  args: string[],
  onProgress?: (percent: number, speed: string, eta: string) => void,
  poToken?: string,
): Promise<void> {
  const proc = trySpawnYtdlp(args, poToken);
  if (!proc) throw new Error("yt-dlp not found or failed to start");

  let stderrText = "";
  const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      stderrText += text;
      for (const line of text.split("\n")) {
        const parsed = parseProgressLine(line);
        if (parsed && onProgress)
          onProgress(parsed.percent, parsed.speed, parsed.eta);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const trimmed = stderrText.slice(0, 1500);
    logger.warn(`[download] yt-dlp exit ${exitCode}: ${trimmed}`);
    throw new Error(trimmed || "Download failed");
  }
}

async function attemptDownload(
  url: string,
  outputPath: string,
  fmt: string,
  quality: string,
  cookiesFile: string | undefined,
  includeThumbnail: boolean,
  onProgress?: (percent: number, speed: string, eta: string) => void,
  browser?: string,
  browserProfile?: string | null,
  poToken?: string,
): Promise<void> {
  const ext = fmt === "mp3" ? "mp3" : "mp4";
  const useFfmpeg = await checkFfmpeg();

  const args: string[] = [
    url,
    "--no-warnings",
    "--newline",
    "--progress",
    "--embed-metadata",
    "--extractor-retries",
    "5",
    "--retries",
    "15",
  ];

  if (browser) {
    args.push(
      "--cookies-from-browser",
      browserProfile ? `${browser}:${browserProfile}` : browser,
    );
  } else if (cookiesFile) {
    args.push("--cookies", cookiesFile);
  }

  if (includeThumbnail) {
    args.push("--write-thumbnail");
  }

  if (fmt === "mp3") {
    if (useFfmpeg) {
      const tempDir = join(
        tmpdir(),
        `ytdl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      );
      mkdirSync(tempDir, { recursive: true });

      try {
        const tempBase = join(tempDir, "audio");
        args.push("-f", "bestaudio", "-o", `${tempBase}.%(ext)s`);

        logger.log(`[download] two-step mp3: downloading native audio`);
        await spawnAndMonitor(args, onProgress, poToken);

        const tempFiles = readdirSync(tempDir);
        const tempFile = tempFiles.find(
          (f) => f !== "thumbnail" && !/\.(jpg|jpeg|png|webp)$/i.test(f),
        );
        if (!tempFile) throw new Error("No audio file produced by yt-dlp");

        const thumbPath = includeThumbnail ? findThumbnail(tempDir) : undefined;
        logger.log(
          `[download] two-step mp3: converting to mp3${thumbPath ? " with thumbnail" : ""}`,
        );
        await convertToMp3(join(tempDir, tempFile), outputPath, thumbPath);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } else {
      args.push(
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
      );
      args.push("-o", outputPath.replace(`.${ext}`, ".%(ext)s"));
      if (includeThumbnail) args.push("--embed-thumbnail");
      logger.log(`[download] one-step mp3`);
      await spawnAndMonitor(args, onProgress, poToken);
    }
  } else {
    if (useFfmpeg) {
      const tempDir = join(
        tmpdir(),
        `ytdl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      );
      mkdirSync(tempDir, { recursive: true });

      try {
        const tempBase = join(tempDir, "video");
        args.push(
          "-f",
          `best[height<=${quality}]`,
          "-o",
          `${tempBase}.%(ext)s`,
        );

        logger.log(`[download] two-step mp4: downloading native format`);
        await spawnAndMonitor(args, onProgress, poToken);

        const tempFiles = readdirSync(tempDir);
        const tempFile = tempFiles.find(
          (f) => !/\.(jpg|jpeg|png|webp)$/i.test(f),
        );
        if (!tempFile) throw new Error("No video file produced by yt-dlp");

        const tempFilePath = join(tempDir, tempFile);
        const tempExt = extname(tempFilePath).toLowerCase();

        const thumbPath = includeThumbnail ? findThumbnail(tempDir) : undefined;

        if (tempExt === ".mp4" && !thumbPath) {
          logger.log(`[download] two-step mp4: already mp4, moving`);
          renameSync(tempFilePath, outputPath);
        } else {
          logger.log(
            `[download] two-step mp4: converting to mp4${thumbPath ? " with thumbnail" : ""}`,
          );
          await convertToMp4(tempFilePath, outputPath, thumbPath);
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } else {
      args.push(
        "-f",
        `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`,
      );
      args.push("--merge-output-format", "mp4");
      args.push("-o", outputPath.replace(`.${ext}`, ".%(ext)s"));
      if (includeThumbnail) args.push("--embed-thumbnail");
      logger.log(`[download] one-step mp4`);
      await spawnAndMonitor(args, onProgress, poToken);
    }
  }
}

export async function importPlaylist(
  url: string,
  name: string,
): Promise<PlaylistImportResult> {
  logger.log(`[playlist] import url="${url}" name="${name}"`);
  const { stdout, exitCode } = await safeExecYtdlp([
    url,
    "--dump-json",
    "--flat-playlist",
    "--ignore-errors",
    "--no-warnings",
    "--quiet",
  ]);
  if (exitCode !== 0) {
    logger.warn(`[playlist] import exit code ${exitCode}`);
    throw new Error(
      "This URL is not supported. Only YouTube playlists work with this feature.",
    );
  }

  const tracks: string[] = [];
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    try {
      const e = JSON.parse(line);
      if (e && e.title) tracks.push(String(e.title));
    } catch {
      logger.debug(`failed to parse playlist track`);
    }
  }

  if (!tracks.length) {
    logger.warn(`[playlist] no tracks found for "${url}"`);
    throw new Error(
      "This URL is not supported. Only YouTube playlists work with this feature.",
    );
  }

  logger.log(`[playlist] imported "${name}" with ${tracks.length} tracks`);
  return { name, count: tracks.length, path: "" };
}

export async function importPlaylistFromUrl(
  url: string,
): Promise<PlaylistImportResult> {
  logger.log(`[playlist] import-from-url url="${url}"`);
  const { stdout, exitCode } = await safeExecYtdlp([
    url,
    "--dump-json",
    "--flat-playlist",
    "--ignore-errors",
    "--no-warnings",
    "--quiet",
  ]);
  if (exitCode !== 0) {
    logger.warn(`[playlist] import-from-url exit code ${exitCode}`);
    throw new Error(
      "This URL is not supported. Only YouTube playlists work with this feature.",
    );
  }

  const lines = stdout.trim().split("\n").filter(Boolean);
  let name = "Untitled Playlist";
  const tracks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const e = JSON.parse(lines[i]!);
      if (i === 0 && e.playlist_title) name = String(e.playlist_title);
      if (e && e.title) tracks.push(String(e.title));
    } catch {
      logger.warn(`failed to parse track at index ${i}`);
    }
  }

  if (!tracks.length) {
    throw new Error(
      "This URL is not supported. Only YouTube playlists work with this feature.",
    );
  }

  return { name, count: tracks.length, path: "" };
}

export async function getYtdlpVersion(): Promise<{
  version: string;
  available: boolean;
}> {
  const { stdout, exitCode } = await safeExecYtdlp(["--version"]);
  return { version: stdout.trim(), available: exitCode === 0 };
}

export async function getLatestPypiVersion(): Promise<string> {
  try {
    const res = await fetch("https://pypi.org/pypi/yt-dlp/json", {
      headers: { "User-Agent": "hp-ytdl-ui/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { info?: { version?: string } };
    return data.info?.version ?? "";
  } catch {
    return "";
  }
}

export async function updateYtdlp(): Promise<{
  updated: boolean;
  version?: string;
  error?: string;
  output?: string;
}> {
  try {
    const binary = ensureYtdlpBinary();
    const pipCmd = binary.includes("-m yt_dlp")
      ? [binary.split(" ")[0]!, "-m", "pip", "install", "-U", "yt-dlp"]
      : ["pip", "install", "-U", "yt-dlp"];

    logger.log(`updating via: ${pipCmd.join(" ")}`);
    const proc = Bun.spawn(pipCmd, { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => {
      try {
        proc.kill();
        logger.log(`update timed out after 120s`);
      } catch {
        logger.debug(`failed to kill timed-out process`);
      }
    }, 120_000);
    const { stdout, stderr, exitCode } = await collectOutput(proc);
    clearTimeout(timer);

    if (exitCode === 0) {
      const { version } = await getYtdlpVersion();
      logger.success(`updated to v${version}`);
      return { updated: true, version, output: stdout.trim() };
    }
    logger.warn(`update failed: ${(stderr || stdout).trim().slice(0, 300)}`);
    return { updated: false, error: (stderr || stdout).trim() };
  } catch (e) {
    logger.error(`update error: ${e}`);
    return { updated: false, error: String(e) };
  }
}


