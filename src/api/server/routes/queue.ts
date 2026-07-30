import type {
  QueueAddRequest,
  QueueConfigRequest,
  QueueReorderRequest,
  QueueResolveRequest,
} from "@/types";
import { downloadQueue } from "@/lib/queue";
import { sse } from "@/lib/api";
import Logger from "@/lib/logger";
import HttpResponse from "@/api/response";

const logger = new Logger("QUEUE");

export const queueAddApi = {
  async POST(req: Request) {
    const body = (await req.json()) as QueueAddRequest;
    const itemId = downloadQueue.add(body);
    logger.log(`add id=${itemId} url="${body.url}" fmt=${body.fmt}`);
    return HttpResponse.json({ item_id: itemId });
  },
};

export const queueReorderApi = {
  async POST(req: Request) {
    const body = (await req.json()) as QueueReorderRequest;
    downloadQueue.reorder(body.id, body.new_index);
    logger.log(`reorder id=${body.id} to=${body.new_index}`);
    return HttpResponse.json({ ok: true });
  },
};

export const queueClearApi = {
  POST() {
    downloadQueue.clearCompleted();
    logger.log("cleared completed items");
    return HttpResponse.json({ ok: true });
  },
};

export const queueConfigApi = {
  async POST(req: Request) {
    const body = (await req.json()) as QueueConfigRequest;
    downloadQueue.setMaxConcurrent(body.max_concurrent);
    logger.log(`config max_concurrent=${body.max_concurrent}`);
    return HttpResponse.json({ max_concurrent: body.max_concurrent });
  },
};

export const queueSkipApi = {
  async POST(req: Request) {
    const ok = downloadQueue.skip((req as any).params.itemId!);
    logger.log(`skip id=${(req as any).params.itemId} ok=${ok}`);
    return HttpResponse.json({ ok });
  },
};

export const queueResolveApi = {
  async POST(req: Request) {
    const body = (await req.json()) as QueueResolveRequest;
    const ok = downloadQueue.resolveConflict(
      (req as any).params.itemId!,
      body.action,
    );
    if (!ok) return HttpResponse.error("Cannot resolve conflict", 400);
    logger.log(`resolve id=${(req as any).params.itemId} action=${body.action}`);
    return HttpResponse.json({ ok: true });
  },
};

export const queueRemoveApi = {
  async DELETE(req: Request) {
    const ok = downloadQueue.remove((req as any).params.itemId!);
    if (!ok) return HttpResponse.error("Item not found", 404);
    logger.log(`remove id=${(req as any).params.itemId}`);
    return HttpResponse.json({ removed: true });
  },
};

export const queueProgressApi = () =>
  sse((controller, signal) => {
    const interval = setInterval(() => {
      if (signal.aborted) {
        clearInterval(interval);
        return;
      }
      const state = downloadQueue.getState();
      try {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(state)}\n\n`),
        );
      } catch {
        /* client disconnected */
      }
    }, 500);
    signal.addEventListener("abort", () => clearInterval(interval));
  });
