import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { type KiriEvent, LiveEventsProvider, useLiveSync } from "./live.tsx";

afterEach(() => cleanup());

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
