import { serve } from "bun";
import index from "@/index.html";

import { COOKIES_FILE, DATA_DIR, PLAYLISTS_DIR } from "@/config/paths";
import Logger from "@/lib/logger";
import PlaylistWatcher from "@/api/server/watcher";
import {
  createPlaylistEventApi,
  searchApi,
  metadataApi,
} from "@/api/server/route";

import {
  playlistsApi,
  playlistImportApi,
  playlistImportFromUrlApi,
  playlistImportSpotifyApi,
  playlistCheckExistingApi,
  playlistRenameApi,
  playlistAddApi,
  playlistGetApi,
  playlistDeleteApi,
  playlistReorderApi,
} from "@/api/server/routes/playlists";
import {
  playlistRenameWholeApi,
  playlistCleanupApi,
  playlistConvertCsvApi,
  playlistCompressApi,
  playlistNormalizeApi,
  playlistResyncApi,
} from "@/api/server/routes/edit";
import {
  queueAddApi,
  queueReorderApi,
  queueClearApi,
  queueConfigApi,
  queueSkipApi,
  queueResolveApi,
  queueRemoveApi,
  queueProgressApi,
} from "@/api/server/routes/queue";
import { ytdlpVersionApi, ytdlpUpdateApi } from "@/api/server/routes/ytdlp";
import {
  cookiesApi,
  cookiesDetectApi,
  cookiesInspectApi,
  cookiesSigninApi,
  cookiesSigninStatusApi,
  cookiesSigninCancelApi,
  cookiesVerifyApi,
} from "@/api/server/routes/cookies";
import { appVersionApi } from "@/api/server/routes/app";

const logger = new Logger("SERVER");
const playlistWatcher = new PlaylistWatcher(PLAYLISTS_DIR);

playlistWatcher.start();

const server = serve({
  routes: {
    "/*": index,

    "/api/search": searchApi,
    "/api/metadata": metadataApi,

    "/api/playlists": playlistsApi,
    "/api/playlists/import": playlistImportApi,
    "/api/playlists/import-from-url": playlistImportFromUrlApi,
    "/api/playlists/import-spotify": playlistImportSpotifyApi,
    "/api/playlists/add": playlistAddApi,
    "/api/playlists/check-existing": playlistCheckExistingApi,
    "/api/playlists/:name": playlistGetApi,
    "/api/playlists/:name/add": playlistAddApi,
    "/api/playlists/:name/delete": playlistDeleteApi,
    "/api/playlists/:name/reorder": playlistReorderApi,
    "/api/playlists/:name/rename": playlistRenameWholeApi,
    "/api/playlists/:name/cleanup": playlistCleanupApi,
    "/api/playlists/:name/convert-csv": playlistConvertCsvApi,
    "/api/playlists/:name/compress": playlistCompressApi,
    "/api/playlists/:name/normalize": playlistNormalizeApi,
    "/api/playlists/:name/resync": playlistResyncApi,
    "/api/rename/playlist/:name": playlistRenameApi,

    "/api/queue/add": queueAddApi,
    "/api/queue/reorder": queueReorderApi,
    "/api/queue/clear": queueClearApi,
    "/api/queue/config": queueConfigApi,
    "/api/queue/skip/:itemId": queueSkipApi,
    "/api/queue/resolve/:itemId": queueResolveApi,
    "/api/queue/:itemId": queueRemoveApi,
    "/api/queue/progress": queueProgressApi,

    "/api/ytdlp/version": ytdlpVersionApi,
    "/api/ytdlp/update": ytdlpUpdateApi,

    "/api/app/version": appVersionApi,

    "/api/cookies": cookiesApi,
    "/api/cookies/detect": cookiesDetectApi,
    "/api/cookies/inspect": cookiesInspectApi,
    "/api/cookies/verify": cookiesVerifyApi,
    "/api/cookies/signin": cookiesSigninApi,
    "/api/cookies/signin/status": cookiesSigninStatusApi,
    "/api/cookies/signin/cancel": cookiesSigninCancelApi,

    "/api/events/playlists": createPlaylistEventApi(playlistWatcher),
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

logger.log(`started at ${server.url}`);
logger.log(`data: ${DATA_DIR}`);
logger.log(`cookies: ${COOKIES_FILE}`);

// Bun.spawn({
//   cmd: ["cmd", "/c", "start", "", server.url.toString()],
//   stdout: "ignore",
//   stderr: "ignore",
//   stdin: "ignore",
// });
