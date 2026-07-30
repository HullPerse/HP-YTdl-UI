import { getLatestPypiVersion, getYtdlpVersion, updateYtdlp } from "@/lib/ytdlp";
import Logger from "@/lib/logger";
import HttpResponse from "@/api/response";

const logger = new Logger("YT-DLP");

export const ytdlpVersionApi = async () => {
  const { version, available } = await getYtdlpVersion();
  const latest = await getLatestPypiVersion();

  const curNorm = version
    .split(".")
    .map((p) => p.replace(/^0+/, "") || "0")
    .join(".");
  const latNorm = latest
    .split(".")
    .map((p) => p.replace(/^0+/, "") || "0")
    .join(".");
  const updateAvailable = !!(version && latest && curNorm !== latNorm);

  logger.log(`version="${version}" latest="${latest}" available=${available} update=${updateAvailable}`);
  return HttpResponse.json({
    version,
    latest,
    available,
    frozen: false,
    update_available: updateAvailable,
  });
};

export const ytdlpUpdateApi = {
  async POST() {
    logger.log("update requested");
    const result = await updateYtdlp();
    logger.log(`update result: ${JSON.stringify(result)}`);
    return HttpResponse.json(result);
  },
};
