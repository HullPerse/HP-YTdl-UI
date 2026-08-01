import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, extname, join } from "path";

import { COOKIES_FILE, DOWNLOADS_DIR, PLAYLISTS_DIR } from "@/config/paths";
import type { PlaylistCheckBody, PlaylistImportBody } from "@/types";
import {
  cleanTrackLine,
  findPlaylistFile,
  parseYoutubeTitle,
  sanitizeFilename,
} from "@/lib/utils";
import { importPlaylist, importPlaylistFromUrl, ytdlp } from "@/lib/ytdlp";
import Logger from "@/lib/logger";
import HttpResponse from "@/api/response";
import { playlistCache } from "@/lib/cache";

const logger = new Logger("PLAYLISTS");

export async function fetchPlaylistTracks(url: string): Promise<string[]> {
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

    const exitCode = await proc.exited;

    logger.log(`yt-dlp add exit=${exitCode} stdout=${stdout.length} chars`);

    logger.debug(`yt-dlp stdout:\n${stdout}`);

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

export const playlistGetApi = {
  async GET(req: Request) {
    const name = (req as any).params.name as string;
    const playlistPath = findPlaylistFile(name);
    if (!playlistPath) {
      return HttpResponse.error("Playlist not found", 404);
    }
    const content = readFileSync(playlistPath, "utf-8");
    const tracks = content.split("\n").map(cleanTrackLine).filter(Boolean);
    return HttpResponse.json({ name, tracks, count: tracks.length });
  },
};

export const playlistAddApi = {
  async POST(req: Request) {
    const name = (req as any).params.name as string;
    const body = (await req.json()) as { url?: string };

    if (!body.url?.trim()) {
      return HttpResponse.error("URL required", 400);
    }

    const playlistPath = join(PLAYLISTS_DIR, `${sanitizeFilename(name)}.csv`);

    if (!existsSync(playlistPath)) {
      return HttpResponse.error("Playlist not found", 404);
    }

    try {
      const url = body.url.trim();

      logger.log(`add tracks playlist="${name}" url="${url}"`);

      const proc = ytdlp([
        url,
        "--dump-json",
        "--flat-playlist",
        "--ignore-errors",
        "--no-warnings",
        "--quiet",
        "--cookies",
        COOKIES_FILE,
      ]);

      const stdoutPromise = new Response(
        proc.stdout as ReadableStream<Uint8Array>,
      ).text();

      const stderrPromise = new Response(
        proc.stderr as ReadableStream<Uint8Array>,
      ).text();

      const [stdout, stderr] = await Promise.all([
        stdoutPromise,
        stderrPromise,
      ]);

      const exitCode = await proc.exited;

      logger.log(
        `yt-dlp exit=${exitCode} stdout=${stdout.length} stderr=${stderr.length}`,
      );

      if (stderr.trim()) {
        logger.error(`yt-dlp stderr:\n${stderr}`);
      }

      if (exitCode !== 0 && !stdout.trim()) {
        return HttpResponse.error(
          stderr.trim() || "Failed to fetch YouTube video or playlist",
          400,
        );
      }

      const incoming: string[] = [];

      for (const line of stdout.split("\n").filter(Boolean)) {
        try {
          const entry = JSON.parse(line);

          if (!entry?.title) continue;

          const title = cleanTrackLine(String(entry.title));

          if (title) {
            incoming.push(title);
          }
        } catch {
          logger.debug("failed to parse yt-dlp entry");
        }
      }

      if (!incoming.length) {
        return HttpResponse.error("No videos found at the provided URL", 400);
      }

      const existing = readFileSync(playlistPath, "utf-8")
        .split("\n")
        .map(cleanTrackLine)
        .filter(Boolean);

      const existingSet = new Set(existing);

      const added: string[] = [];
      const skipped: string[] = [];

      for (const track of incoming) {
        if (existingSet.has(track)) {
          skipped.push(track);
          continue;
        }

        existingSet.add(track);
        existing.push(track);
        added.push(track);
      }

      writeFileSync(playlistPath, existing.join("\n"), "utf-8");

      playlistCache.delete("all");

      logger.log(
        `added ${added.length} tracks to "${name}", skipped ${skipped.length}`,
      );

      return HttpResponse.json({
        name,
        added,
        skipped,
        addedCount: added.length,
        skippedCount: skipped.length,
        count: existing.length,
      });
    } catch (e) {
      logger.error(`add-to-playlist failed: ${e}`);
      return HttpResponse.error(String(e));
    }
  },
};

export const playlistDeleteApi = {
  async POST(req: Request) {
    const name = (req as any).params.name as string;
    const body = (await req.json()) as { index?: number };
    if (!Number.isInteger(body.index) || body.index! < 0) {
      return HttpResponse.error("Invalid track index", 400);
    }
    const playlistPath = join(PLAYLISTS_DIR, `${sanitizeFilename(name)}.csv`);
    if (!existsSync(playlistPath)) {
      return HttpResponse.error("Playlist not found", 404);
    }
    const tracks = readFileSync(playlistPath, "utf-8")
      .split("\n")
      .map(cleanTrackLine)
      .filter(Boolean);
    if (body.index! >= tracks.length) {
      return HttpResponse.error("Track index out of range", 400);
    }
    const [removed] = tracks.splice(body.index!, 1);
    writeFileSync(playlistPath, tracks.join("\n"), "utf-8");
    playlistCache.delete("all");
    logger.log(`deleted track ${body.index} from "${name}"`);
    return HttpResponse.json({ name, removed, tracks, count: tracks.length });
  },
};

export const playlistReorderApi = {
  async POST(req: Request) {
    const name = (req as any).params.name as string;
    const body = (await req.json()) as { from?: number; to?: number };
    if (
      !Number.isInteger(body.from) ||
      !Number.isInteger(body.to) ||
      body.from! < 0 ||
      body.to! < 0
    ) {
      return HttpResponse.error("Invalid track positions", 400);
    }
    const playlistPath = join(PLAYLISTS_DIR, `${sanitizeFilename(name)}.csv`);
    if (!existsSync(playlistPath)) {
      return HttpResponse.error("Playlist not found", 404);
    }
    const tracks = readFileSync(playlistPath, "utf-8")
      .split("\n")
      .map(cleanTrackLine)
      .filter(Boolean);
    if (body.from! >= tracks.length || body.to! >= tracks.length) {
      return HttpResponse.error("Track position out of range", 400);
    }
    if (body.from === body.to) {
      return HttpResponse.json({ name, tracks, count: tracks.length });
    }
    const [track] = tracks.splice(body.from!, 1);
    if (track === undefined) {
      return HttpResponse.error("Track not found", 404);
    }
    tracks.splice(body.to!, 0, track);
    writeFileSync(playlistPath, tracks.join("\n"), "utf-8");
    playlistCache.delete("all");
    logger.log(`reordered track ${body.from} -> ${body.to} in "${name}"`);
    return HttpResponse.json({ name, tracks, count: tracks.length });
  },
};
