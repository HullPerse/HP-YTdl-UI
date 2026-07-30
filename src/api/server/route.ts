import { parseQuery, sse } from "@/lib/api";
import { getVideoMetadata, searchYoutube } from "@/lib/ytdlp";
import Logger from "@/lib/logger";
import HttpResponse from "../response";
import type PlaylistWatcher from "./watcher";

const logger = new Logger("API");

export function createPlaylistEventApi(playlistWatcher: PlaylistWatcher) {
  return () =>
    sse((controller, signal) => {
      let lastSig = playlistWatcher.getSignature();

      const notify = () => {
        const sig = playlistWatcher.getSignature();
        if (sig === lastSig) return;
        lastSig = sig;

        logger.log("playlist changed, notifying SSE client");

        try {
          controller.enqueue(new TextEncoder().encode("data: changed\n\n"));
        } catch {
          logger.info("client disconnected");
        }
      };

      const unsubscribe = playlistWatcher.subscribe(notify);
      signal.addEventListener("abort", unsubscribe);
    });
}

export const searchApi = async (req: Request) => {
  const query = parseQuery(req.url).get("query");
  const maxResults = Number(parseQuery(req.url).get("max_results") || 8);

  if (!query?.trim()) return HttpResponse.error("Query is empty", 400);

  try {
    logger.log(`query="${query.trim()}" maxResults=${maxResults}`);

    const results = await searchYoutube(query.trim(), maxResults);

    logger.log(`${results.length} results for "${query.trim()}"`);

    return HttpResponse.json({ results });
  } catch (error) {
    logger.error(`failed: ${error}`);
    return HttpResponse.error(`Search failed: ${error}`);
  }
};

export const metadataApi = async (req: Request) => {
  const url = parseQuery(req.url).get("url");

  if (!url?.trim()) return HttpResponse.error("URL is empty", 400);

  try {
    logger.log(`url="${url.trim()}"`);

    const result = await getVideoMetadata(url.trim());

    logger.log(`title="${result.source_title}" duration=${result.duration}`);

    return HttpResponse.json(result);
  } catch (error) {
    logger.error(`"${url.trim()}" failed: ${error}`);
    return HttpResponse.error(`URL failed: ${error}`);
  }
};
