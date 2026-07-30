import { resolve } from "path";
import { mkdirSync } from "fs";

export const APP_DIR = resolve(import.meta.dir, "../../..");
export const DATA_DIR = resolve(APP_DIR, "data");
export const PLAYLISTS_DIR = resolve(DATA_DIR, "playlists");
export const DOWNLOADS_DIR = resolve(DATA_DIR, "downloads");
export const COOKIES_FILE = resolve(DATA_DIR, "cookies.txt");

mkdirSync(PLAYLISTS_DIR, { recursive: true });
mkdirSync(DOWNLOADS_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

export const CHROME_PROFILES = [
  "C:\\Users\\Kocherga\\AppData\\Local\\imput\\Helium\\User Data\\Default",
  "C:\\Users\\Kocherga\\AppData\\Local\\Google\\Chrome\\User Data\\Default",
  "C:\\Users\\Kocherga\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 1",
];

export const EXTRACTOR_ARGS = { youtube: { player_client: ["web"] } };

export const BGUTIL_SERVER_PATH = "C:\\Users\\Kocherga\\bgutil-ytdlp-pot-provider\\server\\build";
export const BGUTIL_GENERATE_ONCE = resolve(BGUTIL_SERVER_PATH, "generate_once.js");
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const STANDARD_BROWSERS = [
  "edge",
  "chrome",
  "firefox",
  "brave",
  "opera",
  "vivaldi",
  "chromium",
];

export const AUTH_COOKIE_NAMES = new Set(["SAPISID", "SSID", "HSID", "SID"]);
