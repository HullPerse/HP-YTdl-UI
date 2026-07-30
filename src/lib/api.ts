export function sse(
  start: (
    controller: ReadableStreamDefaultController,
    signal: AbortSignal,
  ) => void | (() => void),
) {
  let cleanup: (() => void) | undefined;
  const abortController = new AbortController();
  const stream = new ReadableStream({
    start(controller) {
      cleanup = start(controller, abortController.signal) as
        (() => void) | undefined;
    },
    cancel() {
      abortController.abort();
      cleanup?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function parseQuery(url: string): URLSearchParams {
  return new URL(url).searchParams;
}


