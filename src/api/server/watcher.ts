import { watch, type FSWatcher } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import type { Listener } from "@/types";
import Logger from "@/lib/logger";

const logger = new Logger("WATCHER");

const POLL_INTERVAL = 5000;

export default class PlaylistWatcher {
  private listeners = new Set<Listener>();
  private watcher: FSWatcher | null = null;
  private debounce: Timer | null = null;
  private initialized = false;
  private pollingTimer: Timer | null = null;
  private lastSignature = "";

  constructor(private readonly directory: string) {}

  // methods
  start = () => {
    if (this.initialized) return;

    this.initialized = true;
    this.lastSignature = this.getSignature();

    try {
      this.watcher = watch(this.directory, (event, filename) => {
        logger.log(`${event}: ${filename ?? "(unknown)"}`);

        this.lastSignature = this.getSignature();
        this.notify();
      });

      logger.log(`watching ${this.directory}`);
    } catch (error) {
      logger.error(`fs.watch failed, using polling: ${error}`);
    }

    // safety net: detect add/remove/modify even if fs.watch silently misses
    // events (e.g. on Windows deletions may arrive with a null filename)
    this.pollingTimer = setInterval(() => {
      const sig = this.getSignature();
      if (sig === this.lastSignature) return;
      this.lastSignature = sig;
      this.notify();
    }, POLL_INTERVAL);

    process.once("exit", this.stop);
  };

  stop = () => {
    this.watcher?.close();
    this.watcher = null;

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }

    this.listeners.clear();
    this.initialized = false;

    logger.log("stopped");
  };

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  getSignature = () => {
    const parts: string[] = [];

    for (const file of readdirSync(this.directory).sort()) {
      const ext = extname(file).toLowerCase();

      if (ext !== ".csv" && ext !== ".txt") continue;

      try {
        const stat = statSync(join(this.directory, file));

        parts.push(`${file}|${stat.mtimeMs}|${stat.size}`);
      } catch {
        continue;
      }
    }

    return parts.join("||");
  };

  // private methods
  private notify = () => {
    if (this.debounce) {
      clearTimeout(this.debounce);
    }

    this.debounce = setTimeout(() => {
      this.debounce = null;

      for (const listener of this.listeners) {
        try {
          listener();
        } catch (error) {
          logger.error(`listener failed: ${error}`);
        }
      }
    }, 300);
  };
}
