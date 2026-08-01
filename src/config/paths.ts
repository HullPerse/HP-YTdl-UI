import { dirname, resolve } from "path";
import { existsSync, mkdirSync } from "fs";

export const APP_DIR = process.cwd();

export const APP_NAME = "HP YTdl UI";
export const APP_VERSION = "1.2.3";
export const APP_REPO = "HullPerse/HP-YTdl-UI";

export const SCRIPT_PATH =
  [
    resolve(APP_DIR, "cookies_extract.py"),
    resolve(APP_DIR, "src", "lib", "cookies_extract.py"),
    resolve(APP_DIR, "dist", "cookies_extract.py"),
  ].find((p) => existsSync(p)) || resolve(APP_DIR, "cookies_extract.py");
export const DATA_DIR = resolve(APP_DIR, "data");
export const PLAYLISTS_DIR = resolve(DATA_DIR, "playlists");
export const DOWNLOADS_DIR = resolve(DATA_DIR, "downloads");
export const COOKIES_FILE = resolve(DATA_DIR, "cookies.txt");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(PLAYLISTS_DIR, { recursive: true });
mkdirSync(DOWNLOADS_DIR, { recursive: true });

export const CHROME_PROFILES = [
  "C:\\Users\\Kocherga\\AppData\\Local\\imput\\Helium\\User Data\\Default",
  "C:\\Users\\Kocherga\\AppData\\Local\\Google\\Chrome\\User Data\\Default",
  "C:\\Users\\Kocherga\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 1",
];

export const EXTRACTOR_ARGS = { youtube: { player_client: ["web"] } };

const BGUTIL_SERVER_PATH =
  "C:\\Users\\Kocherga\\bgutil-ytdlp-pot-provider\\server\\build";
export const BGUTIL_GENERATE_ONCE = resolve(
  BGUTIL_SERVER_PATH,
  "generate_once.js",
);
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

export const CORE_AUTH_COOKIES = ["SID", "SAPISID", "SSID", "HSID"];

export const AUTH_COOKIE_NAMES = new Set([
  "SAPISID",
  "SSID",
  "HSID",
  "SID",
  "APISID",
  "SIDCC",
  "LOGIN_INFO",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
  "__Secure-3PSIDCC",
]);
