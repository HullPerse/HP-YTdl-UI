import pico from "picocolors";

import type { LogLevel } from "../types";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  success: 4,
};
const ENV_LEVEL = Bun.env.LOG_LEVEL as LogLevel | undefined;
const MIN_LEVEL = LEVELS[ENV_LEVEL ?? "info"] ?? 1;

export default class Logger {
  private author: string;

  constructor(author: string = "SYSTEM") {
    this.author = author.toUpperCase();
  }

  private get timestamp(): string {
    return new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  private format(message: string): string {
    return `[${this.timestamp}] [${this.author}] ${message}`;
  }

  setAuthor(author: string): this {
    this.author = author.toUpperCase();
    return this;
  }

  log = (message: string) => {
    if (MIN_LEVEL <= LEVELS.info) console.log(pico.white(this.format(message)));
  };
  debug = (message: string) => {
    if (MIN_LEVEL <= LEVELS.debug)
      console.debug(pico.magenta(this.format(message)));
  };
  info = (message: string) => {
    if (MIN_LEVEL <= LEVELS.info) console.info(pico.blue(this.format(message)));
  };
  warn = (message: string) => {
    if (MIN_LEVEL <= LEVELS.warn)
      console.warn(pico.yellow(this.format(message)));
  };
  success = (message: string) => {
    if (MIN_LEVEL <= LEVELS.success)
      console.log(pico.green(this.format(message)));
  };
  error = (message: string) => {
    if (MIN_LEVEL <= LEVELS.error)
      console.error(pico.red(this.format(message)));
  };

  clear = () => console.clear();
}
