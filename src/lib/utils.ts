import type { ParsedTitle } from "@/types";
import { CHROME_PROFILES, STANDARD_BROWSERS } from "@/config/paths";

export function sanitizeFilename(name: string): string {
  let s = name.replace(/[\\/:*?"<>|]/g, "_");
  s = s.replace(/^[. ]+|[. ]+$/g, "");
  if (!s) s = "untitled";
  return s.slice(0, 120);
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
  return line.trim().replace(/^\d+[.)]\s*/, "");
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
