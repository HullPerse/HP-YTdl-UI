import type { CookiesBody } from "@/types";
import {
  autoDetectCookies,
  cancelSignin,
  cookiesExist,
  deleteCookiesFile,
  getSigninStatus,
  inspectCookiesFile,
  startSignin,
  writeCookiesFile,
} from "@/lib/cookies";
import { COOKIES_FILE } from "@/config/paths";
import Logger from "@/lib/logger";
import HttpResponse from "@/api/response";

const logger = new Logger("COOKIES");

export const cookiesApi = {
  async GET() {
    const exists = await cookiesExist();
    logger.log(`check exists=${exists}`);
    return HttpResponse.json({ exists, path: COOKIES_FILE });
  },
  async POST(req: Request) {
    const body = (await req.json()) as CookiesBody;
    const len = body.content?.length ?? 0;
    logger.log(`saving ${len} chars`);
    await writeCookiesFile(body.content);
    return HttpResponse.json({ saved: true, path: COOKIES_FILE });
  },
  async DELETE() {
    logger.log("deleting");
    await deleteCookiesFile();
    return HttpResponse.json({ deleted: true });
  },
};

export const cookiesDetectApi = {
  async POST() {
    logger.log("auto-detect started");
    const results = await autoDetectCookies();
    logger.log(`auto-detect found=${results.found} total=${results.total} source=${results.source}`);
    return HttpResponse.json(results);
  },
};

export const cookiesInspectApi = async () => {
  const result = await inspectCookiesFile();
  logger.log(`inspect exists=${result.exists} cookies=${result.total_cookies} domains=${result.domains?.length}`);
  return HttpResponse.json(result);
};

export const cookiesSigninApi = {
  async POST() {
    const status = getSigninStatus();
    if (status.inProgress) {
      logger.log("signin already in progress");
      return HttpResponse.json({ status: "already_in_progress" });
    }
    logger.log("signin started");
    startSignin();
    return HttpResponse.json({ status: "started" });
  },
};

export const cookiesSigninStatusApi = async () => {
  const status = getSigninStatus();
  if (status.done) logger.log(`signin done result=${JSON.stringify(status.result)}`);
  return HttpResponse.json(status);
};

export const cookiesSigninCancelApi = {
  async POST() {
    logger.log("signin cancel requested");
    cancelSignin();
    return HttpResponse.json({ status: "cancelled" });
  },
};
