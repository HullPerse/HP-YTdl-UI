export function sse(
  start: (
    controller: ReadableStreamDefaultController,
    signal: AbortSignal,
  ) => void | (() => void),
) {
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      cleanup = start(controller, new AbortController().signal) as
        (() => void) | undefined;
    },
    cancel() {
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

export function getId(name: string): string {
  return name.split("/").pop() || "";
}
