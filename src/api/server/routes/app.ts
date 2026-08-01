import { APP_NAME, APP_REPO, APP_VERSION } from "@/config/paths";
import Logger from "@/lib/logger";
import HttpResponse from "@/api/response";

const logger = new Logger("APP");

export const appVersionApi = async () => {
  let latest = "";
  let url = "";
  try {
    const res = await fetch(
      `https://api.github.com/repos/${APP_REPO}/releases/latest`,
      {
        headers: {
          "User-Agent": "hp-ytdl-ui/1.0",
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
      };
      latest = (data.tag_name ?? "").replace(/^v/, "");
      url = data.html_url ?? "";
    }
  } catch {
    logger.debug("failed to fetch latest release");
  }

  return HttpResponse.json({
    name: APP_NAME,
    current: APP_VERSION,
    latest: latest || null,
    release_url: url || null,
    update_available: Boolean(latest) && latest !== APP_VERSION,
  });
};
