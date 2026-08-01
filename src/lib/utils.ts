import type { ParsedTitle, PlaylistCleanupOptions } from "@/types";
import { CHROME_PROFILES, PLAYLISTS_DIR, STANDARD_BROWSERS } from "@/config/paths";
import { existsSync } from "fs";
import { join } from "path";

export function sanitizeFilename(name: string): string {
  let s = name.replace(/[\\/:*?"<>|]/g, "_");
  s = s.replace(/^[. ]+|[. ]+$/g, "");
  if (!s) s = "untitled";
  return s.slice(0, 120);
}

export function findPlaylistFile(name: string): string | null {
  const safe = sanitizeFilename(name);
  for (const ext of [".csv", ".txt"]) {
    const candidate = join(PLAYLISTS_DIR, `${safe}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function parseYoutubeTitle(rawTitle: string): ParsedTitle {
  let title = rawTitle.trim();

  title = title.replace(/\s*\(official\s*(?:music\s*)?video\)\s*/gi, " ");
  title = title.replace(/\s*\(official\s*audio\)\s*/gi, " ");
  title = title.replace(/\s*\(lyric\s*video\)\s*/gi, " ");
  title = title.replace(/\s*\(visualizer\)\s*/gi, " ");
  title = title.replace(/\s*\(4k\s*remaster\)\s*/gi, " ");
  title = title.replace(/\s*\(4k\)\s*/gi, " ");
  title = title.replace(/\s*\(hd\)\s*/gi, " ");
  title = title.replace(/\s*\(audio\)\s*/gi, " ");

  title = title.replace(/\s*\|\s*.*$/, "");
  title = title.replace(/\s+_\s+.*$/, "");
  title = title.replace(/\s*-\s*youtube\s*$/i, "");

  const miscParts: string[] = [];
  title = title.replace(/\(([^)]*)\)/g, (_, content: string) => {
    const c = content.trim();
    if (c && !/^(official|video|audio|lyric|visualizer|4k|hd)\b/i.test(c)) {
      miscParts.push(c);
    }
    return "";
  });

  title = title.replace(/\s+/g, " ").trim();

  const miscStr = miscParts.length ? ` [${miscParts.join(", ")}]` : "";

  let artist = "";
  let track = title;
  const m = title.match(/^(.+?)\s+-\s+(.+)$/);
  if (m && m[1] && m[2]) {
    artist = m[1].trim();
    track = m[2].trim();
  }

  const filename = artist
    ? `${artist} - ${track}${miscStr}`
    : `${track}${miscStr}`;

  return {
    artist,
    title: track,
    misc: miscParts.join(", "),
    filename: sanitizeFilename(filename),
    source_title: rawTitle,
  };
}

export function cleanTrackLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  if (isHeaderLine(trimmed)) return "";
  return trimmed.replace(/^\d+[.)]\s*/, "");
}

const HEADER_COLUMN_SET = new Set([
  "artist",
  "title",
  "track",
  "type",
  "name",
  "duration",
  "url",
  "link",
  "channel",
  "year",
  "album",
  "position",
  "index",
]);

export function isHeaderLine(line: string): boolean {
  const tokens = line
    .split(/[|,;]/)
    .map((s) => s.trim().toLowerCase().replace(/:+$/, ""))
    .filter(Boolean);
  return (
    tokens.length >= 2 && tokens.every((s) => HEADER_COLUMN_SET.has(s))
  );
}

export function stripLeadingIndex(line: string): string {
  let s = line.trim();
  let prev: string;
  do {
    prev = s;
    s = s.replace(/^\s*\d{1,5}\s*[.\-,)\t]+\s*/, "");
    s = s.replace(/^\s*#\s*\d{1,5}\s*[.\-,)\t]+\s*/, "");
    s = s.replace(/^\s*\(\s*\d{1,5}\s*\)\s*/, "");
  } while (s !== prev);
  return s.trim();
}

const URL_RE = /^https?:\/\/\S+$/i;

export function stripTimestamp(line: string): string {
  let s = line.trim();
  s = s.replace(/^\s*\[?\d{1,3}:\d{2}(?::\d{2})?\]?\s*[-–—]\s*/, "");
  s = s.replace(/^\s*\[?\d{1,3}:\d{2}(?::\d{2})?\]?\s*/, "");
  s = s.replace(/\s*\[?\d{1,3}:\d{2}(?::\d{2})?\]?\s*$/, "");
  return s.trim();
}

export function cleanupTrackLine(
  line: string,
  options: PlaylistCleanupOptions,
): { value: string; removed: boolean } {
  let value = line.trim();
  if (!value) return { value: "", removed: true };

  if (options.removeHeaders && isHeaderLine(value)) {
    return { value: "", removed: true };
  }

  if (options.removeUrls && URL_RE.test(value)) {
    return { value: "", removed: true };
  }

  if (options.removeTimestamps) {
    value = stripTimestamp(value);
  }

  if (options.removeIndexes) {
    value = stripLeadingIndex(value);
  }

  if (options.normalizeTitles && value && /^.+?\s+-\s+.+/.test(value)) {
    const parsed = parseYoutubeTitle(value);
    value = parsed.artist
      ? `${parsed.artist} - ${parsed.title}${parsed.misc ? ` [${parsed.misc}]` : ""}`
      : parsed.title;
  }

  value = value.replace(/\s+/g, " ").trim();
  return { value, removed: !value };
}

export function cleanupPlaylistLines(
  lines: string[],
  options: PlaylistCleanupOptions,
): { cleaned: string[]; removedLines: string[]; changed: number } {
  const result: string[] = [];
  const removedLines: string[] = [];
  let changed = 0;
  const seen = new Set<string>();

  for (const raw of lines) {
    const original = raw.trim();
    if (!original) continue;

    const { value, removed } = cleanupTrackLine(raw, options);
    if (removed) {
      removedLines.push(original);
      changed++;
      continue;
    }

    if (options.dedupe) {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        removedLines.push(original);
        changed++;
        continue;
      }
      seen.add(key);
    }

    if (value !== original) changed++;
    result.push(value);
  }

  return { cleaned: result, removedLines, changed };
}

export function parseProgressLine(
  line: string,
): { percent: number; speed: string; eta: string } | null {
  const m = line.match(/\[download\]\s+([\d.]+)%/);
  if (!m) return null;
  const speedM = line.match(/at\s+([\d.]+\s*\w+\/s)/i);
  const etaM = line.match(/ETA\s+([\d:]+)/i);
  return {
    percent: parseFloat(m[1]!),
    speed: speedM ? speedM[1]! : "",
    eta: etaM ? etaM[1]! : "",
  };
}

export function getCookieBrowserTargets(): [string, string | null][] {
  const seen = new Set<string>();
  const targets: [string, string | null][] = [];

  for (const browser of STANDARD_BROWSERS) {
    const key = `${browser}:null`;

    if (seen.has(key)) continue;

    targets.push([browser, null]);
    seen.add(key);
  }

  for (const profile of CHROME_PROFILES) {
    const key = `chrome:${profile}`;

    if (seen.has(key)) continue;

    targets.push(["chrome", profile]);
    seen.add(key);
  }

  return targets;
}
