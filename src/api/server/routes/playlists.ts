import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, extname, join } from "path";

import { DOWNLOADS_DIR, PLAYLISTS_DIR } from "@/config/paths";
import type { PlaylistCheckBody, PlaylistImportBody } from "@/types";
import {
  cleanTrackLine,
  parseYoutubeTitle,
  sanitizeFilename,
} from "@/lib/utils";
import { importPlaylist, importPlaylistFromUrl, ytdlp } from "@/lib/ytdlp";
import Logger from "@/lib/logger";
import HttpResponse from "@/api/response";
import { playlistCache } from "@/lib/cache";

const logger = new Logger("PLAYLISTS");

async function fetchPlaylistTracks(url: string): Promise<string[]> {
  try {
    const proc = ytdlp([
      url,
      "--dump-json",
      "--flat-playlist",
      "--ignore-errors",
      "--quiet",
    ]);
    const stdout = await new Response(
      proc.stdout as ReadableStream<Uint8Array>,
    ).text();
    const tracks: string[] = [];
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      try {
        const e = JSON.parse(line);
        if (e?.title) tracks.push(String(e.title));
      } catch {
        /* skip */
      }
    }
    return tracks;
  } catch {
    return [];
  }
}

export const playlistsApi = async () => {
  const cached = playlistCache.get("all");
  if (cached) {
    logger.log(`cache hit: ${cached.length} playlists`);
    return HttpResponse.json(cached);
  }

  const files = readdirSync(PLAYLISTS_DIR).sort();
  const playlists = [];

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext !== ".csv" && ext !== ".txt") continue;

    const name = file.replace(/\.[^.]*$/, "");
    const content = readFileSync(join(PLAYLISTS_DIR, file), "utf-8");
    const tracks = content.split("\n").map(cleanTrackLine).filter(Boolean);

    playlists.push({ name, tracks, count: tracks.length });
  }

  playlistCache.set("all", playlists);
  logger.log(`returning ${playlists.length} playlists`);

  return HttpResponse.json(playlists);
};

export const playlistImportApi = {
  async POST(req: Request) {
    const body = (await req.json()) as PlaylistImportBody;
    if (!body.url?.trim() || !body.name?.trim())
      return HttpResponse.error("URL and name required", 400);

    try {
      logger.log(`import name="${body.name}" url="${body.url}"`);

      const result = await importPlaylist(body.url.trim(), body.name.trim());
      const tracks = await fetchPlaylistTracks(body.url.trim());

      const playlistPath = join(
        PLAYLISTS_DIR,
        `${sanitizeFilename(body.name.trim())}.csv`,
      );
      writeFileSync(playlistPath, tracks.join("\n"), "utf-8");

      playlistCache.delete("all");
      logger.log(`imported "${result.name}" with ${result.count} tracks`);
      return HttpResponse.json({ ...result, path: playlistPath });
    } catch (e) {
      logger.error(`import failed: ${e}`);
      return HttpResponse.error(String(e));
    }
  },
};

export const playlistImportFromUrlApi = {
  async POST(req: Request) {
    const body = (await req.json()) as PlaylistImportBody;
    if (!body.url?.trim()) return HttpResponse.error("URL required", 400);

    try {
      logger.log(`import-from-url url="${body.url}"`);

      const result = await importPlaylistFromUrl(body.url.trim());
      const tracks = await fetchPlaylistTracks(body.url.trim());

      const playlistPath = join(
        PLAYLISTS_DIR,
        `${sanitizeFilename(result.name)}.csv`,
      );
      writeFileSync(playlistPath, tracks.join("\n"), "utf-8");

      playlistCache.delete("all");
      logger.log(`imported "${result.name}" with ${result.count} tracks`);
      return HttpResponse.json({ ...result, path: playlistPath });
    } catch (e) {
      logger.error(`import-from-url failed: ${e}`);
      return HttpResponse.error(String(e));
    }
  },
};

export const playlistCheckExistingApi = {
  async POST(req: Request) {
    const body = (await req.json()) as PlaylistCheckBody;
    const existing: number[] = [];

    for (let i = 0; i < body.tracks.length; i++) {
      const parsed = parseYoutubeTitle(body.tracks[i]!);
      let name = body.template
        .replace("{artist}", parsed.artist)
        .replace("{title}", parsed.title)
        .replace("{misc}", parsed.misc ? ` [${parsed.misc}]` : "")
        .replace("{channel}", "")
        .replace("{id}", "")
        .replace("{ext}", "")
        .replace("{playlist}", "")
        .replace("{quality}", "")
        .replace("{source_title}", body.tracks[i]!);
      name = name.replace(/\s+/g, " ").trim();
      const safe = sanitizeFilename(name);

      for (const ext of [".mp3", ".mp4", ".m4a", ".webm"]) {
        if (existsSync(join(DOWNLOADS_DIR, `${safe}${ext}`))) {
          existing.push(i);
          break;
        }
      }
    }

    logger.log(
      `check-existing: ${existing.length}/${body.tracks.length} exist`,
    );
    return HttpResponse.json({ existing });
  },
};

export const playlistRenameApi = {
  async POST(req: Request) {
    const name = (req as any).params.name!;
    const playlistDir = join(DOWNLOADS_DIR, name);
    if (!existsSync(playlistDir))
      return HttpResponse.error("Playlist download directory not found", 404);

    logger.log(`rename playlist="${name}"`);

    const files = readdirSync(PLAYLISTS_DIR).sort();
    let pl: { name: string; tracks: string[]; count: number } | undefined;

    for (const f of files) {
      const ext = extname(f).toLowerCase();
      if (ext !== ".csv" && ext !== ".txt") continue;
      if (f.replace(/\.[^.]*$/, "") === name) {
        const content = readFileSync(join(PLAYLISTS_DIR, f), "utf-8");
        const tracks = content.split("\n").map(cleanTrackLine).filter(Boolean);
        pl = { name, tracks, count: tracks.length };
        break;
      }
    }

    if (!pl) return HttpResponse.error("Playlist not found", 404);

    const dlFiles = readdirSync(playlistDir)
      .map((f) => join(playlistDir, f))
      .filter((f) => statSync(f).isFile())
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const renamed: { old: string; new: string }[] = [];
    const errors: string[] = [];

    for (let i = 0; i < dlFiles.length; i++) {
      const f = dlFiles[i]!;
      if (i >= pl.tracks.length) {
        errors.push(`${basename(f)}: no playlist track at index ${i}`);
        continue;
      }
      const parsed = parseYoutubeTitle(pl.tracks[i]!);
      const newName = `${parsed.filename}${extname(f)}`;
      const newPath = join(playlistDir, newName);
      if (existsSync(newPath)) {
        errors.push(`${basename(f)}: target ${newName} already exists`);
        continue;
      }
      renameSync(f, newPath);
      renamed.push({ old: basename(f), new: newName });
    }

    logger.log(`renamed ${renamed.length} files (${errors.length} errors)`);
    return HttpResponse.json({ renamed, errors, total: dlFiles.length });
  },
};
