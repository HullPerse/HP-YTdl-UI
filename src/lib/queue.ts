import type { QueueItemData } from "@/types";
import {
  sanitizeFilename,
  parseProgressLine,
  getCookieBrowserTargets,
} from "@/lib/utils";
import { COOKIES_FILE, DOWNLOADS_DIR } from "@/config/paths";
import { ytdlp, trySpawnYtdlp } from "@/lib/ytdlp";
import { unlinkSync } from "fs";
import PQueue from "p-queue";
import Logger from "@/lib/logger";

const logger = new Logger("QUEUE");

let itemIdCounter = 0;

function genId(): string {
  return (++itemIdCounter).toString(36).padStart(6, "0");
}

class DownloadQueueManager {
  items: QueueItemData[] = [];
  private queue: PQueue;

  constructor(maxConcurrent = 2) {
    this.queue = new PQueue({ concurrency: maxConcurrent });
  }

  get maxConcurrent(): number {
    return this.queue.concurrency;
  }

  set maxConcurrent(n: number) {
    this.queue.concurrency = Math.max(0, n);
  }

  add(
    params: {
      url: string;
      filename: string;
      fmt: string;
      quality: string;
      playlist: string;
      output_dir: string;
      include_thumbnail: boolean;
    },
    priority = 0,
  ): string {
    const item: QueueItemData = {
      id: genId(),
      url: params.url,
      filename: params.filename,
      fmt: params.fmt,
      quality: params.quality,
      playlist: params.playlist,
      output_dir: params.output_dir,
      include_thumbnail: params.include_thumbnail,
      status: "waiting",
      progress: 0,
      downloaded_bytes: 0,
      total_bytes: 0,
      speed: 0,
      eta: 0,
      error: "",
      output_path: "",
    };
    this.items.push(item);
    this.queue.add(() => this._processItem(item), { priority });
    logger.log(
      `add id=${item.id} "${item.filename}" fmt=${item.fmt} quality=${item.quality} priority=${priority}`,
    );
    return item.id;
  }

  remove(itemId: string): boolean {
    const idx = this.items.findIndex((it) => it.id === itemId);
    if (idx === -1) return false;
    const item = this.items[idx]!;
    if (item.status === "downloading") {
      item.status = "cancelled";
    } else {
      this.items.splice(idx, 1);
    }
    logger.log(`remove id=${itemId} status=${item.status}`);
    return true;
  }

  skip(itemId: string): boolean {
    const ok = this.remove(itemId);
    if (ok) logger.log(`skip id=${itemId}`);
    return ok;
  }

  reorder(itemId: string, newIndex: number): void {
    const idx = this.items.findIndex((it) => it.id === itemId);
    if (idx === -1) return;
    const [item] = this.items.splice(idx, 1);
    const clamped = Math.max(0, Math.min(newIndex, this.items.length));
    this.items.splice(clamped, 0, item!);
    logger.log(`reorder id=${itemId} from=${idx} to=${clamped}`);
  }

  clearCompleted(): void {
    const before = this.items.length;
    this.items = this.items.filter(
      (it) => it.status === "waiting" || it.status === "downloading",
    );
    const removed = before - this.items.length;
    logger.log(`cleared ${removed} completed items`);
  }

  resolveConflict(itemId: string, action: "overwrite" | "skip"): boolean {
    const item = this.items.find((it) => it.id === itemId);
    if (!item || item.status !== "conflict") return false;
    logger.log(`resolve id=${itemId} action=${action}`);
    if (action === "overwrite") {
      try {
        if (item.output_path) unlinkSync(item.output_path);
      } catch {
        return false;
      }
      item.status = "waiting";
      item.progress = 0;
      this.queue.add(() => this._processItem(item));
    } else {
      item.status = "completed";
      item.progress = 100;
    }
    return true;
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(0, n);
    logger.log(`config max_concurrent=${this.maxConcurrent}`);
  }

  getState(): QueueItemData[] {
    return this.items.map((it) => ({ ...it }));
  }

  private async _retryWithBrowserCookies(
    item: QueueItemData,
  ): Promise<boolean> {
    for (const [browser, profile] of getCookieBrowserTargets()) {
      if (item.status === "cancelled") return false;
      try {
        const ext = item.fmt === "mp3" ? "mp3" : "mp4";
        const outtmpl = item.output_path.replace(`.${ext}`, ".%(ext)s");
        const args: string[] = [
          item.url,
          "-o",
          outtmpl,
          "--cookies-from-browser",
          profile ? `${browser}:${profile}` : browser,
        ];
        if (item.fmt === "mp3") {
          args.push(
            "-f",
            "bestaudio/best",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
          );
        } else {
          args.push(
            "-f",
            `bestvideo[height<=${item.quality}]+bestaudio/best[height<=${item.quality}]`,
            "--merge-output-format",
            "mp4",
          );
        }
        const proc = ytdlp(args);
        await proc.exited;
        const exitCode = await proc.exited;
        if (exitCode === 0) {
          item.status = "completed";
          item.progress = 100;
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async _processItem(item: QueueItemData): Promise<void> {
    if (item.status !== "waiting") return;

    try {
      const safeName = sanitizeFilename(item.filename);
      const ext = item.fmt === "mp3" ? "mp3" : "mp4";

      const baseDir = item.output_dir || DOWNLOADS_DIR;
      const subdir = item.playlist ? `${baseDir}/${item.playlist}` : baseDir;

      item.output_path = `${subdir}/${safeName}.${ext}`;

      item.status = "downloading";
      logger.log(`start id=${item.id} "${safeName}.${ext}"`);

      if (await Bun.file(item.output_path).exists()) {
        item.status = "conflict";
        item.progress = 0;
        logger.log(`conflict id=${item.id} path="${item.output_path}"`);
        return;
      }

      const outtmpl = item.output_path.replace(`.${ext}`, ".%(ext)s");
      const args: string[] = [
        item.url,
        "-o",
        outtmpl,
        "--newline",
        "--progress",
        "--embed-metadata",
      ];

      if (await Bun.file(COOKIES_FILE).exists()) {
        args.push("--cookies", COOKIES_FILE);
      }

      if (item.include_thumbnail) {
        args.push("--write-thumbnail", "--embed-thumbnail");
      }

      if (item.fmt === "mp3") {
        args.push(
          "-f",
          "bestaudio/best",
          "-x",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "0",
        );
      } else {
        args.push(
          "-f",
          `bestvideo[height<=${item.quality}]+bestaudio/best[height<=${item.quality}]`,
          "--merge-output-format",
          "mp4",
        );
      }

      const proc = trySpawnYtdlp(args);
      if (!proc) throw new Error("yt-dlp not found or failed to start");

      const stderrReader = (
        proc.stderr as ReadableStream<Uint8Array>
      ).getReader();
      const decoder = new TextDecoder();
      let stderrText = "";

      try {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          stderrText += text;
          for (const line of text.split("\n")) {
            const parsed = parseProgressLine(line);
            if (parsed) {
              item.downloaded_bytes = Math.round(
                (parsed.percent / 100) * (item.total_bytes || 100_000_000),
              );
              item.total_bytes = item.total_bytes || 100_000_000;
              item.speed = parseFloat(parsed.speed) || 0;
              item.progress = parsed.percent;
            }
          }
        }
      } finally {
        stderrReader.releaseLock();
      }

      const exitCode = await proc.exited;
      if (exitCode === 0) {
        item.status = "completed";
        item.progress = 100;
        logger.log(`complete id=${item.id} path="${item.output_path}"`);
      } else {
        if (item.status === "cancelled") return;
        logger.warn(
          `fail id=${item.id} exit=${exitCode}: ${stderrText.slice(0, 300)}`,
        );
        if (
          stderrText.includes("403") ||
          stderrText.toLowerCase().includes("forbidden")
        ) {
          logger.log(`403/forbidden, retrying with browser cookies`);
          const retried = await this._retryWithBrowserCookies(item);
          if (retried) return;
        }
        item.status = "failed";
        item.error = stderrText || "Download failed";
      }
    } catch (e) {
      logger.error(`error id=${item.id}: ${e}`);
      if (item.status === "cancelled") return;
      item.status = "failed";
      item.error = String(e);
    }
  }
}

export const downloadQueue = new DownloadQueueManager(2);
