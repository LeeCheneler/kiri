import { describe, expect, it, mock } from "bun:test";
import { act, render } from "@testing-library/react";
import { useState } from "react";
import { CONNECTING, captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { type KiriEvent, LiveEventsProvider, useLiveEvent, useLiveReconnect } from "./live.tsx";

// The reconnect is a real timer, so poll rather than sleep a fixed guess.
const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(2);
  }
};

describe("LiveEventsProvider", () => {
  it("opens an EventSource at /api/events on mount", () => {
    const { factory, sources } = captureEventSources();
    render(
      <LiveEventsProvider factory={factory}>
        <p>x</p>
      </LiveEventsProvider>,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe("/api/events");
  });

  it("closes the EventSource on unmount", () => {
    const { factory, sources } = captureEventSources();
    const ui = render(
      <LiveEventsProvider factory={factory}>
        <p>x</p>
      </LiveEventsProvider>,
    );
    ui.unmount();
    expect(sources[0]?.closed).toBe(true);
  });

  it("leaves a dropped transport to the browser's own retry", async () => {
    const { factory, sources } = captureEventSources();
    render(
      <LiveEventsProvider factory={factory} reconnectBaseMs={1}>
        <p>x</p>
      </LiveEventsProvider>,
    );
    act(() => sources[0]?.triggerOpen());

    // Still CONNECTING: the browser is already reconnecting this stream.
    act(() => sources[0]?.triggerError(CONNECTING));

    await Bun.sleep(20);
    expect(sources).toHaveLength(1);
  });

  it("rebuilds the stream the browser has abandoned", async () => {
    const { factory, sources } = captureEventSources();
    render(
      <LiveEventsProvider factory={factory} reconnectBaseMs={1}>
        <p>x</p>
      </LiveEventsProvider>,
    );
    act(() => sources[0]?.triggerOpen());

    act(() => sources[0]?.triggerError());

    await waitFor(() => sources.length === 2);
    expect(sources[0]?.closed).toBe(true);
    expect(sources[1]?.url).toBe("/api/events");
  });

  it("backs off exponentially while the endpoint keeps failing", async () => {
    const { factory, sources } = captureEventSources();
    render(
      <LiveEventsProvider factory={factory} reconnectBaseMs={20}>
        <p>x</p>
      </LiveEventsProvider>,
    );

    // First failure waits ~20ms, the second ~40ms — so after ~30ms the second
    // stream exists but a further failure has not yet produced a third.
    act(() => sources[0]?.triggerError());
    await waitFor(() => sources.length === 2);
    act(() => sources[1]?.triggerError());
    await Bun.sleep(30);
    expect(sources).toHaveLength(2);

    await waitFor(() => sources.length === 3, 200);
  });

  it("resets the backoff once a rebuilt stream opens", async () => {
    const { factory, sources } = captureEventSources();
    render(
      <LiveEventsProvider factory={factory} reconnectBaseMs={20}>
        <p>x</p>
      </LiveEventsProvider>,
    );
    act(() => sources[0]?.triggerError());
    await waitFor(() => sources.length === 2);

    // A successful open clears the attempt count, so the next failure waits the
    // base delay again rather than the doubled one.
    act(() => sources[1]?.triggerOpen());
    act(() => sources[1]?.triggerError());
    await waitFor(() => sources.length === 3, 60);
  });

  it("abandons a pending reconnect when the provider unmounts", async () => {
    const { factory, sources } = captureEventSources();
    const ui = render(
      <LiveEventsProvider factory={factory} reconnectBaseMs={20}>
        <p>x</p>
      </LiveEventsProvider>,
    );
    act(() => sources[0]?.triggerError());
    ui.unmount();

    await Bun.sleep(50);
    expect(sources).toHaveLength(1);
  });

  it("retries at once when the tab regains focus mid-backoff", async () => {
    const { factory, sources } = captureEventSources();
    render(
      // Long enough that only the focus can be what rebuilds the stream.
      <LiveEventsProvider factory={factory} reconnectBaseMs={10_000}>
        <p>x</p>
      </LiveEventsProvider>,
    );
    act(() => sources[0]?.triggerError());
    expect(sources).toHaveLength(1);

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => sources.length === 2);
  });

  it("retries at once when the tab becomes visible mid-backoff", async () => {
    const { factory, sources } = captureEventSources();
    render(
      <LiveEventsProvider factory={factory} reconnectBaseMs={10_000}>
        <p>x</p>
      </LiveEventsProvider>,
    );
    act(() => sources[0]?.triggerError());

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => sources.length === 2);
  });

  it("stays put when the tab is hidden or the stream is healthy", async () => {
    const { factory, sources } = captureEventSources();
    render(
      <LiveEventsProvider factory={factory} reconnectBaseMs={10_000}>
        <p>x</p>
      </LiveEventsProvider>,
    );

    // Healthy stream: focus is not a refetch trigger, so nothing is rebuilt.
    act(() => sources[0]?.triggerOpen());
    act(() => window.dispatchEvent(new Event("focus")));
    expect(sources).toHaveLength(1);

    // Backing off, but the tab is hidden — leave it for the timer. `visibilityState`
    // is inherited, so shadow it with an own property and delete it afterwards;
    // leaving it defined would report "hidden" to every later test in the process.
    act(() => sources[0]?.triggerError());
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      await Bun.sleep(20);
      expect(sources).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
    expect(document.visibilityState).toBe("visible");
  });

  it("falls back to the native EventSource when no factory is provided", () => {
    const constructed: string[] = [];
    class StubEventSource {
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        constructed.push(url);
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    const original = (globalThis as { EventSource?: unknown }).EventSource;
    (globalThis as { EventSource?: unknown }).EventSource = StubEventSource;
    try {
      render(
        <LiveEventsProvider>
          <p>x</p>
        </LiveEventsProvider>,
      );
    } finally {
      (globalThis as { EventSource?: unknown }).EventSource = original;
    }
    expect(constructed).toEqual(["/api/events"]);
  });
});

const EventProbe = ({
  on,
  handler,
}: {
  on: KiriEvent["type"][];
  // biome-ignore lint/suspicious/noExplicitAny: handler is narrowed in the public API; tests pass plain functions.
  handler: (event: any) => void;
}) => {
  useLiveEvent({ on, handler });
  return null;
};

describe("useLiveEvent", () => {
  it("calls the handler with the typed payload when a subscribed event fires", () => {
    const { factory, sources } = captureEventSources();
    const events: KiriEvent[] = [];
    render(
      <LiveEventsProvider factory={factory}>
        <EventProbe on={["run.finished"]} handler={(e) => events.push(e)} />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok" });
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "run.finished", id: "r1", status: "ok" });
  });

  it("ignores event types the handler didn't subscribe to", () => {
    const { factory, sources } = captureEventSources();
    const handler = mock(() => {});
    render(
      <LiveEventsProvider factory={factory}>
        <EventProbe on={["run.finished"]} handler={handler} />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.emit({ type: "run.started", id: "r1" });
    });

    expect(handler).toHaveBeenCalledTimes(0);
  });

  it("does not fire on reconnect — only on dispatched events", () => {
    const { factory, sources } = captureEventSources();
    const handler = mock(() => {});
    render(
      <LiveEventsProvider factory={factory}>
        <EventProbe on={["run.finished"]} handler={handler} />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.triggerOpen();
    });
    act(() => {
      sources[0]?.triggerOpen();
    });

    expect(handler).toHaveBeenCalledTimes(0);
  });

  it("uses the latest handler closure without re-subscribing", () => {
    const { factory, sources } = captureEventSources();
    const a: KiriEvent[] = [];
    const b: KiriEvent[] = [];

    const Toggle = () => {
      const [which, setWhich] = useState<"a" | "b">("a");
      const handler = (event: KiriEvent) => (which === "a" ? a : b).push(event);
      return (
        <>
          <EventProbe on={["run.finished"]} handler={handler} />
          <button type="button" onClick={() => setWhich("b")}>
            swap
          </button>
        </>
      );
    };

    const ui = render(
      <LiveEventsProvider factory={factory}>
        <Toggle />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok" });
    });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);

    act(() => {
      ui.container.querySelector("button")?.click();
    });
    act(() => {
      sources[0]?.emit({ type: "run.finished", id: "r2", status: "failed" });
    });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("removes the handler when its component unmounts", () => {
    const { factory, sources } = captureEventSources();
    const handler = mock(() => {});

    const ui = render(
      <LiveEventsProvider factory={factory}>
        <EventProbe on={["run.finished"]} handler={handler} />
      </LiveEventsProvider>,
    );

    act(() => {
      ui.rerender(
        <LiveEventsProvider factory={factory}>
          <p>gone</p>
        </LiveEventsProvider>,
      );
    });

    act(() => {
      sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok" });
    });
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it("throws when used outside the provider", () => {
    expect(() => render(<EventProbe on={["run.finished"]} handler={() => {}} />)).toThrow(
      /inside <LiveEventsProvider>/,
    );
  });
});

const ReconnectProbe = ({ onReconnect }: { onReconnect: () => void }) => {
  useLiveReconnect(onReconnect);
  return null;
};

describe("useLiveReconnect", () => {
  it("does not fire on the initial open — only on subsequent reconnects", () => {
    const { factory, sources } = captureEventSources();
    const onReconnect = mock(() => {});
    render(
      <LiveEventsProvider factory={factory}>
        <ReconnectProbe onReconnect={onReconnect} />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.triggerOpen();
    });
    expect(onReconnect).toHaveBeenCalledTimes(0);

    act(() => {
      sources[0]?.triggerOpen();
    });
    expect(onReconnect).toHaveBeenCalledTimes(1);

    act(() => {
      sources[0]?.triggerOpen();
    });
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("fires every subscriber on reconnect", () => {
    const { factory, sources } = captureEventSources();
    const a = mock(() => {});
    const b = mock(() => {});
    render(
      <LiveEventsProvider factory={factory}>
        <ReconnectProbe onReconnect={a} />
        <ReconnectProbe onReconnect={b} />
      </LiveEventsProvider>,
    );

    act(() => sources[0]?.triggerOpen());
    act(() => sources[0]?.triggerOpen());

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("fires when a stream rebuilt after a failed initial connect opens", async () => {
    const { factory, sources } = captureEventSources();
    const onReconnect = mock(() => {});
    render(
      <LiveEventsProvider factory={factory} reconnectBaseMs={1}>
        <ReconnectProbe onReconnect={onReconnect} />
      </LiveEventsProvider>,
    );

    // The first stream is abandoned before it ever opens, so events published
    // between mount and the rebuild's open were never delivered.
    act(() => sources[0]?.triggerError());
    await waitFor(() => sources.length === 2);

    act(() => sources[1]?.triggerOpen());
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("ignores dispatched events — only reconnects trigger the handler", () => {
    const { factory, sources } = captureEventSources();
    const onReconnect = mock(() => {});
    render(
      <LiveEventsProvider factory={factory}>
        <ReconnectProbe onReconnect={onReconnect} />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.emit({ type: "run.started", id: "r1" });
      sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok" });
    });

    expect(onReconnect).toHaveBeenCalledTimes(0);
  });

  it("uses the latest handler closure without re-subscribing", () => {
    const { factory, sources } = captureEventSources();
    const calls: string[] = [];

    const Rerenderer = () => {
      const [tag, setTag] = useState("a");
      useLiveReconnect(() => calls.push(tag));
      return (
        <button type="button" onClick={() => setTag("b")}>
          flip
        </button>
      );
    };

    const { getByRole } = render(
      <LiveEventsProvider factory={factory}>
        <Rerenderer />
      </LiveEventsProvider>,
    );

    act(() => sources[0]?.triggerOpen());
    act(() => sources[0]?.triggerOpen());
    expect(calls).toEqual(["a"]);

    act(() => {
      getByRole("button").click();
    });

    act(() => sources[0]?.triggerOpen());
    expect(calls).toEqual(["a", "b"]);
  });

  it("throws when used outside the provider", () => {
    expect(() => render(<ReconnectProbe onReconnect={() => {}} />)).toThrow(
      /inside <LiveEventsProvider>/,
    );
  });
});
