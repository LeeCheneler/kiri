import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { useActivityFeed, useActivityFeedLive } from "./activity.ts";
import { createQueryClient } from "./query-client.ts";

const renderProbe = (ui: ReactNode) => {
  const { factory, sources } = captureEventSources();
  const result = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>{ui}</LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...result, sources };
};

// Probe whose rendered text is the loaded entry ids, kept live by
// useActivityFeedLive.
const FeedProbe = () => {
  useActivityFeedLive();
  const { data } = useActivityFeed();
  if (!data) return <p>loading</p>;
  return (
    <p>{data.map((e) => (e.kind === "run" ? e.run.id : e.session.id)).join(",") || "empty"}</p>
  );
};

// Serve an activity page whose only entry's id encodes the fetch count, so a
// refetch is observable as the rendered id advancing a-1 → a-2 → …
const serveCountingActivity = () => {
  let calls = 0;
  server.use(
    http.get("*/api/activity", () => {
      calls++;
      return HttpResponse.json({
        entries: [{ kind: "run", run: { id: `a-${calls}` } }],
        nextCursor: null,
      });
    }),
  );
};

describe("activity state", () => {
  it("fetches the unified activity feed newest-first", async () => {
    server.use(
      http.get("*/api/activity", () =>
        HttpResponse.json({
          entries: [
            { kind: "session", session: { id: "s2" } },
            { kind: "run", run: { id: "r1" } },
          ],
          nextCursor: null,
        }),
      ),
    );
    renderProbe(<FeedProbe />);
    expect(await screen.findByText("s2,r1")).toBeDefined();
  });

  it("refetches the feed on run and session lifecycle events", async () => {
    serveCountingActivity();
    const { sources } = renderProbe(<FeedProbe />);
    await screen.findByText("a-1");

    act(() => sources[0]?.emit({ type: "run.started", id: "r9" }));
    await screen.findByText("a-2");

    act(() => sources[0]?.emit({ type: "session.started", id: "s9" }));
    await screen.findByText("a-3");
  });

  it("recovers the feed on event-stream reconnect", async () => {
    serveCountingActivity();
    const { sources } = renderProbe(<FeedProbe />);
    await screen.findByText("a-1");

    // First open is the initial connect (silent); the second is a reconnect.
    act(() => sources[0]?.triggerOpen());
    act(() => sources[0]?.triggerOpen());
    await screen.findByText("a-2");
  });
});
