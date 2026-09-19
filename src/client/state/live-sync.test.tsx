import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { LiveSync } from "./live-sync.tsx";
import { createQueryClient } from "./query-client.ts";
import { projectKey, searchKey, sessionKey, versionKey } from "./query-keys.ts";

const renderLiveSync = () => {
  const { factory, sources } = captureEventSources();
  const queryClient = createQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <LiveEventsProvider factory={factory}>
        <LiveSync />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  const isStale = (queryKey: readonly unknown[]) =>
    queryClient.getQueryState(queryKey)?.isInvalidated ?? false;
  return { queryClient, sources, isStale };
};

describe("<LiveSync>", () => {
  it("invalidates what an event names, mounted or not, and nothing else", () => {
    const { queryClient, sources, isStale } = renderLiveSync();
    queryClient.setQueryData(sessionKey("s1"), {});
    queryClient.setQueryData(sessionKey("s2"), {});
    queryClient.setQueryData(projectKey("p1"), {});

    act(() => sources[0]?.emit({ type: "session.inbox.withdrawn", sessionId: "s1" }));

    expect(isStale(sessionKey("s1"))).toBe(true);
    expect(isStale(sessionKey("s2"))).toBe(false);
    expect(isStale(projectKey("p1"))).toBe(false);
  });

  it("restales everything an event could have changed on reconnect, leaving static queries alone", () => {
    const { queryClient, sources, isStale } = renderLiveSync();
    queryClient.setQueryData(sessionKey("s1"), {});
    queryClient.setQueryData(projectKey("p1"), {});
    queryClient.setQueryData(searchKey("term"), {});
    queryClient.setQueryData(versionKey, {});

    act(() => sources[0]?.triggerOpen());
    expect(isStale(sessionKey("s1"))).toBe(false);

    act(() => sources[0]?.triggerOpen());
    expect(isStale(sessionKey("s1"))).toBe(true);
    expect(isStale(projectKey("p1"))).toBe(true);
    expect(isStale(searchKey("term"))).toBe(false);
    expect(isStale(versionKey)).toBe(false);
  });
});
