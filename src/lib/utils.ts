import type { PlaylistCleanupOptions } from "@/types";
import { CHROME_PROFILES, PLAYLISTS_DIR, STANDARD_BROWSERS } from "@/config/paths";
import { existsSync } from "fs";
import { join } from "path";
import {
  sanitizeFilename,
  renderFilenameTemplate,
  parseYoutubeTitle,
} from "./filename";
export {
  sanitizeFilename,
  renderFilenameTemplate,
  parseYoutubeTitle,
};

export function findPlaylistFile(name: string): string | null {
  const safe = sanitizeFilename(name);
  for (const ext of [".csv", ".txt"]) {
    const candidate = join(PLAYLISTS_DIR, `${safe}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
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
): {
  percent: number;
  speed: string;
  eta: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  speed_bytes?: number;
  eta_seconds?: number;
} | null {
  const custom =
    /\[download\]\s+(\d+)\s+(\d+)\s+([\d.]+)%\s+([\d.]+\s*\w+\/s)\s+([\d:]+)\s+(\d+)\s+(\d+)/i.exec(
      line,
    );
  if (custom) {
    return {
      percent: parseFloat(custom[3]!),
      speed: custom[4]!,
      eta: custom[5]!,
      downloaded_bytes: parseInt(custom[1]!, 10),
      total_bytes: parseInt(custom[2]!, 10),
      speed_bytes: parseInt(custom[6]!, 10),
      eta_seconds: parseInt(custom[7]!, 10),
    };
  }

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
