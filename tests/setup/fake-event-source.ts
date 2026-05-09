import type {
  EventSourceFactory,
  EventSourceLike,
  KiriEvent,
} from "../../src/client/events/live.tsx";

/**
 * Test double for the browser's `EventSource`. Tests register listeners via
 * `addEventListener`, then drive the bus with `emit(event)` to dispatch one
 * frame, or `triggerOpen()` to simulate an SSE (re)connect. Records `closed`
 * so tests can assert lifecycle cleanup.
 */
export class FakeEventSource implements EventSourceLike {
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly url: string;
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  close(): void {
    this.closed = true;
  }

  triggerOpen(): void {
    this.onopen?.(new Event("open"));
  }

  emit(event: KiriEvent): void {
    const listeners = this.listeners.get(event.type);
    if (!listeners) return;
    const message = { data: JSON.stringify(event) } as unknown as MessageEvent;
    for (const handler of listeners) handler(message);
  }
}

/**
 * Build an `EventSourceFactory` that records every `FakeEventSource` it
 * constructs so tests can drive them after render.
 */
export const captureEventSources = (): {
  factory: EventSourceFactory;
  sources: FakeEventSource[];
} => {
  const sources: FakeEventSource[] = [];
  const factory: EventSourceFactory = (url) => {
    const source = new FakeEventSource(url);
    sources.push(source);
    return source;
  };
  return { factory, sources };
};
