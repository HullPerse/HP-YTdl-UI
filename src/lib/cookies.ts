import { COOKIES_FILE, AUTH_COOKIE_NAMES, CORE_AUTH_COOKIES, SCRIPT_PATH } from "@/config/paths";
import type { CookieDetectResult, CookieInspectResult } from "@/types";
import { writeFile, unlink } from "fs/promises";
import { getPythonBinary } from "@/lib/ytdlp";
import { join } from "path";
import { getCookieBrowserTargets } from "./utils";
import Logger from "@/lib/logger";

const logger = new Logger("COOKIES");

async function extractCookiesFromBrowser(
  browser: string,
  profile: string | null,
  outputPath: string,
): Promise<{ success: boolean; error?: string }> {
  const python = getPythonBinary();
  const args = [
    python,
    SCRIPT_PATH,
    "--browser",
    browser,
    "--output",
    outputPath,
  ];
  if (profile) args.push("--profile", profile);

  logger.log(`python extract: ${browser}${profile ? `:${profile}` : ""}`);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(
    proc.stdout as ReadableStream<Uint8Array>,
  ).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    let error = "";
    try {
      error = JSON.parse(stdout.trim()).error || stdout;
    } catch {
      error = stdout.trim();
    }
    logger.log(`extract failed: ${error || `exit ${exitCode}`}`);
    return { success: false, error: error || `exit code ${exitCode}` };
  }

  try {
    const result = JSON.parse(stdout.trim());
    return { success: result.success, error: result.error };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function cookiesExist(): Promise<boolean> {
  return await Bun.file(COOKIES_FILE).exists();
}

async function readCookiesFile(): Promise<string> {
  return await Bun.file(COOKIES_FILE).text();
}

export async function writeCookiesFile(content: string): Promise<void> {
  await writeFile(COOKIES_FILE, content, "utf-8");
}

export async function deleteCookiesFile(): Promise<void> {
  try {
    await unlink(COOKIES_FILE);
  } catch {
    logger.debug(`failed to delete cookies file`);
  }
}

export async function inspectCookiesFile(): Promise<CookieInspectResult> {
  if (!(await cookiesExist())) {
    return { exists: false };
  }

  const content = await readCookiesFile();
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("\t"));

  const authCookies: string[] = [];
  const domains = new Set<string>();

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length >= 7) {
      const domain = parts[0]!.replace(/^\./, "");
      const name = parts[5]!;
      domains.add(domain);
      if (AUTH_COOKIE_NAMES.has(name)) {
        authCookies.push(name);
      }
    }
  }

  const missingAuth = [...AUTH_COOKIE_NAMES].filter(
    (n) => !authCookies.includes(n),
  );

  let age_ms: number | undefined;
  try {
    const stat = await Bun.file(COOKIES_FILE).stat();
    age_ms = Date.now() - stat.mtime.getTime();
  } catch {
    /* ignore */
  }

  return {
    exists: true,
    total_cookies: lines.length,
    domains: [...domains].sort(),
    auth_cookies_present: authCookies,
    missing_auth: missingAuth,
    has_all_auth: missingAuth.length === 0,
    age_ms,
  };
}

function classifyCookieError(err: unknown, label: string): string {
  const msg = String(err).toLowerCase();
  if (!msg) return `${label}:error`;
  if (/could not find|no such file|not found/.test(msg)) return "not_found";
  if (/could not copy|permission denied|being used|locked/.test(msg))
    return "locked";
  if (/no cookies|empty/.test(msg)) return "no_cookies";
  if (/keyring|decrypt/.test(msg)) return "decrypt_failed";
  return `${label}:error:${msg.slice(0, 60)}`;
}

export async function autoDetectCookies(): Promise<CookieDetectResult> {
  const resultInfo: Record<string, string> = {};
  const targets = getCookieBrowserTargets();

  logger.log(`auto-detect checking ${targets.length} browsers`);

  let bestJar = "";
  let bestLabel = "";
  let bestScore = -1;
  let bestYtCount = 0;
  let bestTotal = 0;

  for (const [browser, profile] of targets) {
    const label = profile
      ? `${browser}:${profile.split("\\").pop() || "default"}`
      : browser;

    logger.log(`checking ${label}...`);
    try {
      const tmpFile = COOKIES_FILE + ".tmp";
      const { success } = await extractCookiesFromBrowser(
        browser,
        profile,
        tmpFile,
      );

      if (success && (await Bun.file(tmpFile).exists())) {
        const content = await Bun.file(tmpFile).text();
        const lines = content
          .split("\n")
          .filter((l) => l && !l.startsWith("#") && l.includes("\t"));
        const ytLines = lines.filter((l) => l.includes("youtube.com"));
        const authCount = ytLines.filter((l) => {
          const parts = l.split("\t");
          return parts.length >= 7 && AUTH_COOKIE_NAMES.has(parts[5]!);
        }).length;

        const score = ytLines.length * 10 + authCount * 100 + lines.length;
        resultInfo[label] =
          `${lines.length}cookies(${ytLines.length}yt,${authCount}auth)`;
        logger.log(
          `${label}: ${lines.length} cookies, ${ytLines.length} yt, ${authCount} auth (score=${score})`,
        );

        if (score > bestScore) {
          bestJar = content;
          bestLabel = label;
          bestScore = score;
          bestYtCount = ytLines.length;
          bestTotal = lines.length;
        }

        try {
          await unlink(tmpFile);
        } catch {
          logger.debug(`failed to remove tmp cookies for ${label}`);
        }
      } else {
        logger.log(`${label}: no cookies extracted`);
        resultInfo[label] = "no_cookies";
      }
    } catch (e) {
      resultInfo[label] = classifyCookieError(e, label);
      logger.log(`${label}: ${resultInfo[label]}`);
    }
  }

  if (!bestJar) {
    const detail = Object.entries(resultInfo)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    logger.log(`no cookies found: ${detail}`);
    return {
      found: false,
      total: 0,
      detail: detail || "no supported browsers found",
      per_browser: resultInfo,
    };
  }

  logger.log(`best: ${bestLabel} (${bestTotal} cookies, ${bestYtCount} yt)`);
  try {
    const ytLines = bestJar
      .split("\n")
      .filter((l) => l.includes("youtube.com") && !l.startsWith("#"));
    const presentAuth = ytLines
      .filter((l) => {
        const parts = l.split("\t");
        return parts.length >= 7 && AUTH_COOKIE_NAMES.has(parts[5]!);
      })
      .map((l) => l.split("\t")[5]!);
    const hasCore = CORE_AUTH_COOKIES.every((c) => presentAuth.includes(c));

    if (!hasCore) {
      logger.log(
        `best profile not signed into YouTube: missing ${CORE_AUTH_COOKIES.filter((c) => !presentAuth.includes(c)).join(", ")}`,
      );
      return {
        found: false,
        total: 0,
        detail: `${bestLabel} is NOT signed into YouTube (missing ${CORE_AUTH_COOKIES.filter((c) => !presentAuth.includes(c)).join(", ")}). Sign in to YouTube in the browser, close it, and retry.`,
        per_browser: resultInfo,
      };
    }

    const netscape = [
      "# Netscape HTTP Cookie File",
      "# Generated by HP YTdl UI",
      ...ytLines,
    ].join("\n");
    await writeCookiesFile(netscape);

    const missingAuth = [...AUTH_COOKIE_NAMES].filter(
      (n) => !presentAuth.includes(n),
    );

    return {
      found: true,
      total: bestYtCount,
      youtube_cookies: bestYtCount,
      auth_cookies: presentAuth.length,
      missing_auth: missingAuth,
      has_all_auth: missingAuth.length === 0,
      source: bestLabel,
      detail: `Extracted ${bestTotal} cookies from ${bestLabel} (${bestYtCount} for YouTube, ${presentAuth.length} auth cookies)`,
      per_browser: resultInfo,
    };
  } catch (error) {
    logger.error(` write failed: ${error}`);
    return {
      found: false,
      total: 0,
      detail: `write_failed:${error}`,
      per_browser: resultInfo,
    };
  }
}

const LOGIN_URL =
  "https://accounts.google.com/ServiceLogin?continue=https://www.youtube.com&hl=en";

export default class SigninManager {
  private inProgress = false;
  private done = false;
  private result: Record<string, unknown> | null = null;

  getStatus = (): {
    mode: string;
    inProgress: boolean;
    done: boolean;
    result: Record<string, unknown> | null;
  } => {
    return {
      mode: "web",
      inProgress: this.inProgress,
      done: this.done,
      result: this.result,
    };
  };

  cancel = (): void => {
    if (this.inProgress) {
      logger.log(`signin cancelled by user`);
      this.inProgress = false;
      this.done = true;
      this.result = { success: false, error: "Cancelled by user" };
    }
  };

  start = (): void => {
    if (this.inProgress) return;
    this.inProgress = true;
    this.done = false;
    this.result = null;

    Bun.spawn(["cmd", "/c", "start", LOGIN_URL], {
      stdout: "ignore",
      stderr: "ignore",
    });
    logger.log(`signin: opened browser to login page`);

    const targets = getCookieBrowserTargets();
    let attempts = 0;
    const maxAttempts = 60;

    const poll = async (): Promise<void> => {
      while (attempts < maxAttempts && this.inProgress) {
        await new Promise((r) => setTimeout(r, 5000));
        attempts++;
        logger.log(`signin poll attempt ${attempts}/${maxAttempts}`);

        let best: {
          browser: string;
          ytLines: string[];
          authNames: string[];
        } | null = null;

        for (const [browser, profile] of targets) {
          if (!this.inProgress) return;
          try {
            const tmpFile = COOKIES_FILE + ".tmp";
            const { success } = await extractCookiesFromBrowser(
              browser,
              profile,
              tmpFile,
            );

            if (success && (await Bun.file(tmpFile).exists())) {
              const content = await Bun.file(tmpFile).text();
              const ytLines = content
                .split("\n")
                .filter(
                  (l) => l.includes("youtube.com") && !l.startsWith("#"),
                );
              const authNames = ytLines
                .filter((l) => {
                  const parts = l.split("\t");
                  return (
                    parts.length >= 7 && AUTH_COOKIE_NAMES.has(parts[5]!)
                  );
                })
                .map((l) => l.split("\t")[5]!);

              if (authNames.length > 0) {
                if (!best || authNames.length > best.authNames.length) {
                  best = { browser, ytLines, authNames };
                }
              }
              try {
                await unlink(tmpFile);
              } catch {
                logger.debug(`failed to remove signin tmp cookies`);
              }
            }
          } catch {
            continue;
          }
        }

        if (best) {
          const hasCore = CORE_AUTH_COOKIES.every((c) =>
            best.authNames.includes(c),
          );
          logger.log(
            `signin round: ${best.browser} auth=${best.authNames.join(",")} core=${hasCore}`,
          );
          if (hasCore) {
            const netscape = [
              "# Netscape HTTP Cookie File",
              "# Generated by HP YTdl UI",
              ...best.ytLines,
            ].join("\n");
            await writeCookiesFile(netscape);
            this.result = {
              success: true,
              total: best.ytLines.length,
              youtube_cookies: best.ytLines.length,
              auth_cookies: best.authNames,
              has_all_auth: true,
            };
            this.done = true;
            this.inProgress = false;
            return;
          }
        }
      }

      if (this.inProgress) {
        logger.log(`signin timed out after ${maxAttempts} attempts`);
        this.result = {
          success: false,
          error:
            "Sign-in not detected. Make sure you're signed into YouTube in the browser, then close the browser fully and try again.",
        };
        this.done = true;
        this.inProgress = false;
      }
    };

    poll();
  };
}

export const signinManager = new SigninManager();
