import { existsSync, readdirSync, statSync } from "fs";
import { extname, join, relative } from "path";

import { DOWNLOADS_DIR } from "@/config/paths";
import Logger from "@/lib/logger";
import HttpResponse from "@/api/response";

const logger = new Logger("FILES");

export const downloadFileApi = async (req: Request) => {
  const filepath = join(DOWNLOADS_DIR, (req as any).params.filename);
  if (!existsSync(filepath)) return HttpResponse.error("File not found", 404);
  const file = Bun.file(filepath);
  return new Response(file);
};

export const downloadsListApi = async () => {
  const filesList: { name: string; size: number }[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile() &&
        [".mp3", ".mp4", ".m4a", ".webm"].includes(
          extname(entry.name).toLowerCase(),
        )
      ) {
        filesList.push({
          name: relative(DOWNLOADS_DIR, full),
          size: statSync(full).size,
        });
      }
    }
  }

  walk(DOWNLOADS_DIR);
  filesList.sort((a, b) => a.name.localeCompare(b.name));

  logger.log(`returning ${filesList.length} files`);
  return HttpResponse.json({ files: filesList });
};
