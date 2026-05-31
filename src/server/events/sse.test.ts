import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { type EventBus, type EventListener, type KiriEvent, createEventBus } from "./bus.ts";
import { mountEventsRoute } from "./sse.ts";

interface CountedBus extends EventBus {
  readonly subscriberCount: number;
}

const createCountedBus = (): CountedBus => {
  const real = createEventBus();
  let count = 0;
  return {
    publish(event: KiriEvent) {
      real.publish(event);
    },
    subscribe(listener: EventListener) {
      const off = real.subscribe(listener);
      count++;
      return () => {
        count--;
        off();
      };
    },
    get subscriberCount() {
      return count;
    },
  };
};

const readUntil = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 1000,
): Promise<string> => {
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (!predicate(buf)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`stream timeout; got:\n${buf}`);
    const next = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (next.done) break;
    buf += decoder.decode(next.value, { stream: true });
  }
  if (!predicate(buf)) throw new Error(`stream ended without matching predicate; got:\n${buf}`);
  return buf;
};

const buildApp = (bus: EventBus, heartbeatMs?: number): Hono => {
  const app = new Hono();
  mountEventsRoute(app, heartbeatMs === undefined ? { bus } : { bus, heartbeatMs });
  return app;
};

describe("mountEventsRoute", () => {
  it("streams every published event as event/data SSE frames", async () => {
    const bus = createCountedBus();
    const app = buildApp(bus);

    const res = await app.request("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const body = res.body;
    if (!body) throw new Error("expected response body");
    const reader = body.getReader();

    // The handler's sync prefix (`bus.subscribe`) runs before app.request
    // resolves, so the listener is already registered by here.
    expect(bus.subscriberCount).toBe(1);

    bus.publish({ type: "run.started", id: "r1" });
    bus.publish({ type: "run.finished", id: "r1", status: "ok" });

    const text = await readUntil(reader, (t) => t.includes("run.finished"));

    expect(text).toContain("event: run.started");
    expect(text).toContain('data: {"type":"run.started","id":"r1"}');
    expect(text).toContain("event: run.finished");
    expect(text).toContain('data: {"type":"run.finished","id":"r1","status":"ok"}');

    await reader.cancel();
  });

  it("releases the bus subscription when the client disconnects", async () => {
    const bus = createCountedBus();
    const app = buildApp(bus, 5);

    const res = await app.request("/api/events");
    const body = res.body;
    if (!body) throw new Error("expected response body");
    const reader = body.getReader();

    expect(bus.subscriberCount).toBe(1);

    await reader.cancel();

    // Abort propagates through the stream's cancel callback; give the
    // handler a tick to run its finally-block cleanup.
    for (let i = 0; i < 20 && bus.subscriberCount !== 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(bus.subscriberCount).toBe(0);
  });

  it("emits keep-alive comment frames on the heartbeat cadence", async () => {
    const bus = createCountedBus();
    const app = buildApp(bus, 5);

    const res = await app.request("/api/events");
    const body = res.body;
    if (!body) throw new Error("expected response body");
    const reader = body.getReader();

    const text = await readUntil(reader, (t) => t.includes(": keep-alive"));
    expect(text).toContain(": keep-alive");

    await reader.cancel();
  });
});
