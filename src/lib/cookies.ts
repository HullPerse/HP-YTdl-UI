import { COOKIES_FILE, AUTH_COOKIE_NAMES } from "@/config/paths";
import type { CookieDetectResult, CookieInspectResult } from "@/types";
import { writeFile, readFile, unlink } from "fs/promises";
import { getPythonBinary } from "@/lib/ytdlp";
import { join } from "path";
import { getCookieBrowserTargets } from "./utils";

const SCRIPT_PATH = join(import.meta.dir!, "cookies_extract.py");

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

  console.log(
    `[cookies] python extract: ${browser}${profile ? `:${profile}` : ""}`,
  );
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
    console.log(`[cookies] extract failed: ${error || `exit ${exitCode}`}`);
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

export async function readCookiesFile(): Promise<string> {
  return await Bun.file(COOKIES_FILE).text();
}

export async function writeCookiesFile(content: string): Promise<void> {
  await writeFile(COOKIES_FILE, content, "utf-8");
}

export async function deleteCookiesFile(): Promise<void> {
  try {
    await unlink(COOKIES_FILE);
  } catch {
    /* ignore */
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

  return {
    exists: true,
    total_cookies: lines.length,
    domains: [...domains].sort(),
    auth_cookies_present: authCookies,
    has_all_auth: ["SAPISID", "SSID", "HSID", "SID"].every((n) =>
      authCookies.includes(n),
    ),
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

  console.log(`[cookies] auto-detect checking ${targets.length} browsers`);

  let bestJar = "";
  let bestLabel = "";
  let bestScore = -1;
  let bestYtCount = 0;
  let bestTotal = 0;

  for (const [browser, profile] of targets) {
    const label = profile
      ? `${browser}:${profile.split("\\").pop() || "default"}`
      : browser;

    console.log(`[cookies] checking ${label}...`);
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
        console.log(
          `[cookies] ${label}: ${lines.length} cookies, ${ytLines.length} yt, ${authCount} auth (score=${score})`,
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
          /* ignore */
        }
      } else {
        console.log(`[cookies] ${label}: no cookies extracted`);
        resultInfo[label] = "no_cookies";
      }
    } catch (e) {
      resultInfo[label] = classifyCookieError(e, label);
      console.log(`[cookies] ${label}: ${resultInfo[label]}`);
    }
  }

  if (!bestJar) {
    const detail = Object.entries(resultInfo)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    console.log(`[cookies] no cookies found: ${detail}`);
    return {
      found: false,
      total: 0,
      detail: detail || "no supported browsers found",
      per_browser: resultInfo,
    };
  }

  console.log(
    `[cookies] best: ${bestLabel} (${bestTotal} cookies, ${bestYtCount} yt)`,
  );
  try {
    const ytLines = bestJar
      .split("\n")
      .filter((l) => l.includes("youtube.com") && !l.startsWith("#"));
    const netscape = [
      "# Netscape HTTP Cookie File",
      "# Generated by HP YTdl UI",
      ...ytLines,
    ].join("\n");
    await writeCookiesFile(netscape);

    const authCount = ytLines.filter((l) => {
      const parts = l.split("\t");
      return parts.length >= 7 && AUTH_COOKIE_NAMES.has(parts[5]!);
    }).length;

    const missingAuth = [...AUTH_COOKIE_NAMES].filter(
      (n) => !ytLines.some((l) => l.includes(n)),
    );

    return {
      found: true,
      total: bestYtCount,
      youtube_cookies: bestYtCount,
      auth_cookies: authCount,
      missing_auth: missingAuth,
      has_all_auth: missingAuth.length === 0,
      source: bestLabel,
      detail: `Extracted ${bestTotal} cookies from ${bestLabel} (${bestYtCount} for YouTube, ${authCount} auth cookies)`,
      per_browser: resultInfo,
    };
  } catch (e) {
    console.error(`[cookies] write failed:`, e);
    return {
      found: false,
      total: 0,
      detail: `write_failed:${e}`,
      per_browser: resultInfo,
    };
  }
}

const signinState = {
  inProgress: false,
  done: false,
  result: null as Record<string, unknown> | null,
};

export function getSigninStatus(): {
  mode: string;
  inProgress: boolean;
  done: boolean;
  result: Record<string, unknown> | null;
} {
  return {
    mode: "web",
    inProgress: signinState.inProgress,
    done: signinState.done,
    result: signinState.result,
  };
}

export function cancelSignin(): void {
  if (signinState.inProgress) {
    console.log(`[cookies] signin cancelled by user`);
    signinState.inProgress = false;
    signinState.done = true;
    signinState.result = { success: false, error: "Cancelled by user" };
  }
}

export async function startSignin(): Promise<void> {
  signinState.inProgress = true;
  signinState.done = false;
  signinState.result = null;

  const loginUrl =
    "https://accounts.google.com/ServiceLogin?continue=https://www.youtube.com&hl=en";
  Bun.spawn(["cmd", "/c", "start", loginUrl], {
    stdout: "ignore",
    stderr: "ignore",
  });
  console.log(`[cookies] signin: opened browser to login page`);

  const targets = getCookieBrowserTargets();
  let attempts = 0;
  const maxAttempts = 60;

  const poll = async (): Promise<void> => {
    while (attempts < maxAttempts && signinState.inProgress) {
      await new Promise((r) => setTimeout(r, 5000));
      attempts++;
      console.log(`[cookies] signin poll attempt ${attempts}/${maxAttempts}`);

      for (const [browser, profile] of targets) {
        if (!signinState.inProgress) return;
        const label = profile
          ? `${browser}:${profile.split("\\").pop() || "default"}`
          : browser;
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
              .filter((l) => l.includes("youtube.com") && !l.startsWith("#"));
            const foundAuth = ytLines
              .filter((l) => {
                const parts = l.split("\t");
                return parts.length >= 7 && AUTH_COOKIE_NAMES.has(parts[5]!);
              })
              .map((l) => l.split("\t")[5]!);

            if (foundAuth.length > 0) {
              console.log(
                `[cookies] signin success from ${label}: ${ytLines.length} yt cookies, auth: ${foundAuth.join(",")}`,
              );
              const netscape = [
                "# Netscape HTTP Cookie File",
                "# Generated by HP YTdl UI",
                ...ytLines,
              ].join("\n");
              await writeCookiesFile(netscape);
              signinState.result = {
                success: true,
                total: ytLines.length,
                youtube_cookies: ytLines.length,
                auth_cookies: foundAuth,
                has_all_auth: ["SAPISID", "SSID", "HSID", "SID"].every((n) =>
                  foundAuth.includes(n),
                ),
              };
              signinState.done = true;
              signinState.inProgress = false;
              try {
                await unlink(tmpFile);
              } catch {
                /* ignore */
              }
              return;
            }
            try {
              await unlink(tmpFile);
            } catch {
              /* ignore */
            }
          }
        } catch {
          continue;
        }
      }
    }

    if (signinState.inProgress) {
      console.log(`[cookies] signin timed out after ${maxAttempts} attempts`);
      signinState.result = {
        success: false,
        error: "Timed out. Close your browser fully and try again.",
      };
      signinState.done = true;
      signinState.inProgress = false;
    }
  };

  poll();
}
