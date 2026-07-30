import { existsSync, readdirSync } from "fs";
import { join } from "path";

import { COOKIES_FILE, DOWNLOADS_DIR } from "@/config/paths";
import type { DownloadRequest, DownloadProgress } from "@/types";
import { downloadVideo } from "@/lib/ytdlp";
import { sanitizeFilename, urlHash } from "@/lib/utils";
import { sse } from "@/lib/api";
import Logger from "@/lib/logger";
import HttpResponse from "@/api/response";

const logger = new Logger("DOWNLOAD");
const downloadProgress = new Map<string, DownloadProgress>();

export const downloadApi = {
  async POST(req: Request) {
    const body = (await req.json()) as DownloadRequest;
    const safeName = sanitizeFilename(body.filename);
    const ext = body.fmt;

    const baseDir = body.playlist
      ? join(DOWNLOADS_DIR, body.playlist)
      : DOWNLOADS_DIR;
    const outputPath = join(baseDir, `${safeName}.${ext}`);

    logger.log(`url="${body.url}" fmt=${body.fmt} quality=${body.quality} thumbnail=${body.include_thumbnail}`);

    if (existsSync(outputPath)) {
      logger.log(`already exists: ${outputPath}`);
      return HttpResponse.json({
        filename: `${safeName}.${ext}`,
        path: outputPath,
        already_exists: true,
      });
    }

    try {
      const urlHashKey = urlHash(body.url);
      await downloadVideo(
        body.url,
        outputPath,
        body.fmt,
        body.quality,
        existsSync(COOKIES_FILE) ? COOKIES_FILE : undefined,
        body.include_thumbnail ?? false,
        (percent, speed, eta) => {
          downloadProgress.set(urlHashKey, {
            status: "downloading",
            downloaded_bytes: 0,
            total_bytes: 0,
            speed: parseFloat(speed) || 0,
            eta: parseInt(eta) || 0,
            percent: String(percent),
          });
        },
      );

      const files = readdirSync(baseDir).filter((f) =>
        f.startsWith(safeName),
      );
      const actualFile = files[0] || `${safeName}.${ext}`;

      logger.log(`complete: ${actualFile}`);
      return HttpResponse.json({
        filename: actualFile,
        path: join(baseDir, actualFile),
        already_exists: false,
      });
    } catch (e) {
      let msg = String(e);
      logger.error(`failed: ${msg}`);
      if (/sign in|bot/i.test(msg))
        msg += " - Export cookies.txt from your browser and paste it in Settings";
      return HttpResponse.error(msg);
    }
  },
};

export const downloadProgressApi = (req: Request) =>
  sse((controller, signal) => {
    const interval = setInterval(() => {
      if (signal.aborted) {
        clearInterval(interval);
        return;
      }
      const data = downloadProgress.get((req as any).params.urlHash!);
      if (data) {
        try {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          /* client disconnected */
        }
        if (data.status === "finished" || data.status === "error") {
          clearInterval(interval);
        }
      }
    }, 300);
    signal.addEventListener("abort", () => clearInterval(interval));
  });
