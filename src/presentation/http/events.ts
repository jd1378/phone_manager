const HEARTBEAT_MS = 20_000;
const encoder = new TextEncoder();

export const sseFrame = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export const SSE_HEADERS = { "content-type": "text/event-stream", "cache-control": "no-store" };

/** Server-sent events broadcast to every open page. */
export class EventHub {
  readonly #clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  broadcast(event: string, data: unknown): void {
    const frame = sseFrame(event, data);
    for (const client of this.#clients) {
      try {
        client.enqueue(frame);
      } catch {
        this.#clients.delete(client);
      }
    }
  }

  subscribe(initial: [string, unknown][]): Response {
    let heartbeat: number | undefined;
    let self: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        self = controller;
        this.#clients.add(controller);
        for (const [event, data] of initial) controller.enqueue(sseFrame(event, data));
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            clearInterval(heartbeat);
          }
        }, HEARTBEAT_MS);
      },
      cancel: () => {
        clearInterval(heartbeat);
        this.#clients.delete(self);
      },
    });
    return new Response(body, { headers: SSE_HEADERS });
  }
}
