import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { useArticle, useRecentArticles, useRecentArticlesLive } from "./articles.ts";
import { createQueryClient } from "./query-client.ts";

const Probe = ({ runId, name }: { runId: string; name: string }) => {
  const { data } = useArticle(runId, name);
  return <div>{data?.title}</div>;
};

const renderProbe = (runId: string, name: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Probe runId={runId} name={name} />
    </QueryClientProvider>,
  );

describe("articles state", () => {
  it("fetches and exposes a single article by run id and name", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          name: params.name,
          title: "Morning Briefing",
          contentMd: "# Hello\n\nBody.\n",
          createdAt: new Date().toISOString(),
          workflowName: "briefing",
          heading: "Hello",
          gitSha: null,
          gitDirty: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        }),
      ),
    );

    renderProbe("run-1", "briefing");

    expect(await screen.findByText("Morning Briefing")).toBeDefined();
  });
});

const RecentProbe = () => {
  useRecentArticlesLive();
  const { data } = useRecentArticles();
  return <p>{data ? `count:${data.length}` : "loading"}</p>;
};

const renderRecentProbe = () => {
  const { factory, sources } = captureEventSources();
  const ui = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <RecentProbe />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...ui, sources };
};

// Serve a recent-articles list whose length encodes the fetch count, so a
// refetch is observable as the rendered count advancing 1 → 2 → …
const serveCountingRecent = () => {
  let calls = 0;
  server.use(
    http.get("*/api/articles/recent", () => {
      calls++;
      return HttpResponse.json(Array.from({ length: calls }, (_, i) => ({ name: `a${i}` })));
    }),
  );
  return () => calls;
};

describe("recent articles state", () => {
  it("fetches and exposes the recently-published list", async () => {
    server.use(
      http.get("*/api/articles/recent", () =>
        HttpResponse.json([{ name: "a" }, { name: "b" }, { name: "c" }]),
      ),
    );
    renderRecentProbe();
    expect(await screen.findByText("count:3")).toBeDefined();
  });

  it("refetches as runs finish and as runs are deleted", async () => {
    serveCountingRecent();
    const { sources } = renderRecentProbe();
    await screen.findByText("count:1");

    act(() =>
      sources[0]?.emit({ type: "run.finished", id: "r9", status: "ok", workflowName: "x" }),
    );
    await screen.findByText("count:2");

    act(() => sources[0]?.emit({ type: "run.deleted", id: "r9" }));
    await screen.findByText("count:3");
  });

  it("recovers the list on event-stream reconnect", async () => {
    const callCount = serveCountingRecent();
    const { sources } = renderRecentProbe();
    await screen.findByText("count:1");

    // First open is the initial connect (silent); the second is a reconnect.
    act(() => sources[0]?.triggerOpen());
    expect(callCount()).toBe(1);

    act(() => sources[0]?.triggerOpen());
    await screen.findByText("count:2");
  });
});
