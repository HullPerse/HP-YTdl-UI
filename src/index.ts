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
  playlistCheckExistingApi,
  playlistRenameApi,
} from "@/api/server/routes/playlists";
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
} from "@/api/server/routes/cookies";

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
    "/api/playlists/check-existing": playlistCheckExistingApi,
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

    "/api/cookies": cookiesApi,
    "/api/cookies/detect": cookiesDetectApi,
    "/api/cookies/inspect": cookiesInspectApi,
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
