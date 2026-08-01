import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { extname, join } from "path";

import { DOWNLOADS_DIR, PLAYLISTS_DIR } from "@/config/paths";
import type {
  AudioProcessResult,
  PlaylistCleanupBody,
  PlaylistCleanupOptions,
  PlaylistCleanupResult,
  PlaylistCompressBody,
  PlaylistNormalizeBody,
  PlaylistRenameBody,
  PlaylistResyncBody,
} from "@/types";
import {
  cleanTrackLine,
  cleanupPlaylistLines,
  findPlaylistFile,
  sanitizeFilename,
} from "@/lib/utils";
import { fetchPlaylistTracks } from "./playlists";
import { compressFile, getPlaylistAudioFiles, normalizeFile } from "@/lib/audio";
import { checkFfmpeg } from "@/lib/ytdlp";
import Logger from "@/lib/logger";
import HttpResponse from "@/api/response";
import { playlistCache } from "@/lib/cache";

const logger = new Logger("PLAYLIST-EDIT");

function readPlaylistLines(name: string): { path: string; lines: string[] } | null {
  const path = findPlaylistFile(name);
  if (!path) return null;
  const content = readFileSync(path, "utf-8");
  return { path, lines: content.split("\n").map((l) => l.replace(/\r$/, "")) };
}

export const playlistRenameWholeApi = {
  async POST(req: Request) {
    const name = (req as any).params.name as string;
    const body = (await req.json()) as PlaylistRenameBody;

    if (!body.new_name?.trim()) {
      return HttpResponse.error("New name required", 400);
    }

    const current = findPlaylistFile(name);
    if (!current) return HttpResponse.error("Playlist not found", 404);

    const newName = sanitizeFilename(body.new_name.trim());
    const newExt = extname(current).toLowerCase();
    const newPath = join(PLAYLISTS_DIR, `${newName}${newExt}`);

    if (existsSync(newPath)) {
      return HttpResponse.error(`Playlist "${newName}" already exists`, 409);
    }

    try {
      renameSync(current, newPath);

      const oldDir = join(DOWNLOADS_DIR, name);
      const newDir = join(DOWNLOADS_DIR, newName);
      if (existsSync(oldDir) && !existsSync(newDir)) {
        renameSync(oldDir, newDir);
      }

      playlistCache.delete("all");
      logger.log(`renamed playlist "${name}" -> "${newName}"`);
      return HttpResponse.json({ name: newName, count: readPlaylistLines(newName)?.lines.length ?? 0 });
    } catch (e) {
      logger.error(`rename playlist failed: ${e}`);
      return HttpResponse.error(String(e));
    }
  },
};

export const playlistCleanupApi = {
  async POST(req: Request) {
    const name = (req as any).params.name as string;
    const body = (await req.json()) as PlaylistCleanupBody;
    const options: PlaylistCleanupOptions = body.options ?? {};

    const playlist = readPlaylistLines(name);
    if (!playlist) return HttpResponse.error("Playlist not found", 404);

    const result = cleanupPlaylistLines(playlist.lines, options);
    const response: PlaylistCleanupResult = {
      before: playlist.lines.filter((l) => l.trim()).length,
      after: result.cleaned.length,
      removed: result.removedLines.length,
      changed: result.changed,
      removedLines: result.removedLines,
      preview: result.cleaned,
    };

    if (body.dry_run) {
      return HttpResponse.json(response);
    }

    writeFileSync(playlist.path, result.cleaned.join("\n"), "utf-8");
    playlistCache.delete("all");
    logger.log(`cleaned "${name}": ${result.changed} lines changed`);

    return HttpResponse.json(response);
  },
};

export const playlistConvertCsvApi = {
  async POST(req: Request) {
    const name = (req as any).params.name as string;
    const body = (await req.json()) as PlaylistCleanupBody;
    const options: PlaylistCleanupOptions = body.options ?? {};

    const playlist = readPlaylistLines(name);
    if (!playlist) return HttpResponse.error("Playlist not found", 404);

    const result = cleanupPlaylistLines(playlist.lines, options);
    const safe = sanitizeFilename(name);
    const newPath = join(PLAYLISTS_DIR, `${safe}.csv`);

    writeFileSync(newPath, result.cleaned.join("\n"), "utf-8");

    if (extname(playlist.path).toLowerCase() !== ".csv") {
      unlinkSync(playlist.path);
    }

    playlistCache.delete("all");
    logger.log(`converted "${name}" to csv (${result.cleaned.length} tracks)`);

    return HttpResponse.json({
      name,
      count: result.cleaned.length,
      before: playlist.lines.filter((l) => l.trim()).length,
      removed: result.removedLines.length,
      changed: result.changed,
      removedLines: result.removedLines,
      extension: ".csv",
    });
  },
};

export const playlistCompressApi = {
  async POST(req: Request) {
    const name = (req as any).params.name as string;
    const body = (await req.json()) as PlaylistCompressBody;

    if (!(await checkFfmpeg())) {
      return HttpResponse.error("FFmpeg is not available on this system", 500);
    }

    const files = getPlaylistAudioFiles(name, body.indices);
    if (!files.length) {
      return HttpResponse.error("No downloadable audio files found for this playlist", 404);
    }

    const bitrate = /^\d+k$/.test(body.bitrate ?? "") ? body.bitrate! : "128k";
    const results: AudioProcessResult[] = [];

    for (const { index, file } of files) {
      try {
        await compressFile(join(DOWNLOADS_DIR, name), file, bitrate);
        results.push({ index, file, ok: true });
      } catch (e) {
        results.push({ index, file, ok: false, error: String(e) });
      }
    }

    logger.log(`compressed ${results.filter((r) => r.ok).length}/${results.length} files for "${name}"`);
    return HttpResponse.json({
      name,
      processed: results.filter((r) => r.ok).length,
      errors: results.filter((r) => !r.ok).length,
      results,
    });
  },
};

export const playlistNormalizeApi = {
  async POST(req: Request) {
    const name = (req as any).params.name as string;
    const body = (await req.json()) as PlaylistNormalizeBody;

    if (!(await checkFfmpeg())) {
      return HttpResponse.error("FFmpeg is not available on this system", 500);
    }

    const files = getPlaylistAudioFiles(name, body.indices);
    if (!files.length) {
      return HttpResponse.error("No downloadable audio files found for this playlist", 404);
    }

    const results: AudioProcessResult[] = [];

    for (const { index, file } of files) {
      try {
        await normalizeFile(join(DOWNLOADS_DIR, name), file);
        results.push({ index, file, ok: true });
      } catch (e) {
        results.push({ index, file, ok: false, error: String(e) });
      }
    }

    logger.log(`normalized ${results.filter((r) => r.ok).length}/${results.length} files for "${name}"`);
    return HttpResponse.json({
      name,
      processed: results.filter((r) => r.ok).length,
      errors: results.filter((r) => !r.ok).length,
      results,
    });
  },
};

export const playlistResyncApi = {
  async POST(req: Request) {
    const name = (req as any).params.name as string;
    const body = (await req.json()) as PlaylistResyncBody;

    if (!body.url?.trim()) return HttpResponse.error("URL required", 400);

    const playlist = readPlaylistLines(name);
    if (!playlist) return HttpResponse.error("Playlist not found", 404);

    try {
      const fresh = await fetchPlaylistTracks(body.url.trim());
      if (!fresh.length) return HttpResponse.error("No videos found at the provided URL", 400);

      const oldSet = new Set(
        playlist.lines.map(cleanTrackLine).filter(Boolean),
      );
      const newSet = new Set(fresh.map(cleanTrackLine).filter(Boolean));

      const added = fresh.filter((t) => !oldSet.has(cleanTrackLine(t)));
      const removed = playlist.lines
        .map(cleanTrackLine)
        .filter((t) => t && !newSet.has(t));

      writeFileSync(playlist.path, fresh.join("\n"), "utf-8");
      playlistCache.delete("all");
      logger.log(`resynced "${name}": +${added.length} -${removed.length}`);

      return HttpResponse.json({
        name,
        count: fresh.length,
        added,
        removed,
        addedCount: added.length,
        removedCount: removed.length,
      });
    } catch (e) {
      logger.error(`resync failed: ${e}`);
      return HttpResponse.error(String(e));
    }
  },
};
