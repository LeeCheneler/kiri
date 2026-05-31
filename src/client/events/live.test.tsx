import { describe, expect, it, mock } from "bun:test";
import { act, render } from "@testing-library/react";
import { useState } from "react";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import {
  type KiriEvent,
  LiveEventsProvider,
  useLiveEvent,
  useLiveReconnect,
  useLiveSync,
} from "./live.tsx";

const Probe = ({
  on,
  filter,
  refetch,
}: {
  on: KiriEvent["type"][];
  filter?: (event: KiriEvent) => boolean;
  refetch: () => void;
}) => {
  // biome-ignore lint/suspicious/noExplicitAny: filter is narrowed in the public API; tests pass plain functions.
  useLiveSync({ on, filter: filter as any, refetch });
  return null;
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

  it("falls back to the native EventSource when no factory is provided", () => {
    const constructed: string[] = [];
    class StubEventSource {
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

describe("useLiveSync", () => {
  it("calls refetch when a subscribed event type fires", () => {
    const { factory, sources } = captureEventSources();
    const refetch = mock(() => {});
    render(
      <LiveEventsProvider factory={factory}>
        <Probe on={["run.started"]} refetch={refetch} />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.emit({ type: "run.started", id: "r1" });
    });

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("ignores event types the subscriber didn't ask for", () => {
    const { factory, sources } = captureEventSources();
    const refetch = mock(() => {});
    render(
      <LiveEventsProvider factory={factory}>
        <Probe on={["workflow.added"]} refetch={refetch} />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.emit({ type: "run.started", id: "r1" });
    });

    expect(refetch).toHaveBeenCalledTimes(0);
  });

  it("narrows by filter when one is provided", () => {
    const { factory, sources } = captureEventSources();
    const refetch = mock(() => {});
    render(
      <LiveEventsProvider factory={factory}>
        <Probe
          on={["run.updated"]}
          filter={(e) => e.type === "run.updated" && e.id === "match"}
          refetch={refetch}
        />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "other", status: "running" });
    });
    expect(refetch).toHaveBeenCalledTimes(0);

    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "match", status: "ok" });
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("fires every subscriber's refetch on reconnect (open after first)", () => {
    const { factory, sources } = captureEventSources();
    const a = mock(() => {});
    const b = mock(() => {});
    render(
      <LiveEventsProvider factory={factory}>
        <Probe on={["run.started"]} refetch={a} />
        <Probe on={["workflow.added"]} refetch={b} />
      </LiveEventsProvider>,
    );

    act(() => {
      sources[0]?.triggerOpen();
    });
    expect(a).toHaveBeenCalledTimes(0);
    expect(b).toHaveBeenCalledTimes(0);

    act(() => {
      sources[0]?.triggerOpen();
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("uses the latest refetch and filter without re-subscribing", () => {
    const { factory, sources } = captureEventSources();
    const a = mock(() => {});
    const b = mock(() => {});

    const Toggle = () => {
      const [which, setWhich] = useState<"a" | "b">("a");
      const refetch = which === "a" ? a : b;
      const filter = (e: KiriEvent): boolean =>
        e.type === "run.updated" && e.id === (which === "a" ? "first" : "second");
      return (
        <>
          <Probe on={["run.updated"]} filter={filter} refetch={refetch} />
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
      sources[0]?.emit({ type: "run.updated", id: "first", status: "running" });
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(0);

    act(() => {
      ui.container.querySelector("button")?.click();
    });
    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "first", status: "running" });
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(0);

    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "second", status: "ok" });
    });
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("removes the subscriber when its component unmounts", () => {
    const { factory, sources } = captureEventSources();
    const refetch = mock(() => {});

    const ui = render(
      <LiveEventsProvider factory={factory}>
        <Probe on={["run.started"]} refetch={refetch} />
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
      sources[0]?.emit({ type: "run.started", id: "r1" });
    });
    expect(refetch).toHaveBeenCalledTimes(0);
  });

  it("throws when used outside the provider", () => {
    expect(() => render(<Probe on={["run.started"]} refetch={() => {}} />)).toThrow(
      /inside <LiveEventsProvider>/,
    );
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
