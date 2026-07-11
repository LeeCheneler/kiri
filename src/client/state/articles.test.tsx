import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import {
  type FakeEventSource,
  captureEventSources,
} from "../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import {
  useArticle,
  useRunArticlesLive,
  useSessionArticle,
  useSessionArticles,
  useSessionArticlesLive,
} from "./articles.ts";
import { createQueryClient } from "./query-client.ts";

const Probe = ({ runId, slug }: { runId: string; slug: string }) => {
  const { data } = useArticle(runId, slug);
  return <div>{data?.name}</div>;
};

const renderProbe = (runId: string, slug: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Probe runId={runId} slug={slug} />
    </QueryClientProvider>,
  );

// The root-level article live bridges, as `<LiveSync>` mounts them in the app.
const Live = () => {
  useSessionArticlesLive();
  useRunArticlesLive();
  return null;
};

const DetailProbe = ({ sessionId, slug }: { sessionId: string; slug: string }) => {
  const { data } = useSessionArticle(sessionId, slug);
  return <div>{data?.name}</div>;
};

const ListProbe = ({ sessionId }: { sessionId: string }) => {
  const { data } = useSessionArticles(sessionId);
  return <div>{data ? data.map((a) => a.slug).join(",") || "empty" : "loading"}</div>;
};

// Render session probes under the live bridge, handing back the captured
// event source so tests can announce writes and reconnects.
const renderLive = (ui: React.ReactNode) => {
  const { factory, sources } = captureEventSources();
  const client = createQueryClient();
  const wrap = (children: React.ReactNode) => (
    <QueryClientProvider client={client}>
      <LiveEventsProvider factory={factory}>
        <Live />
        {children}
      </LiveEventsProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(ui));
  return { ...view, wrap, source: () => sources[0] as FakeEventSource };
};

// Serve a session article whose name encodes the fetch count, so a refetch is
// observable as the rendered name advancing v-1 → v-2 → …
const serveCountingDetail = () => {
  let calls = 0;
  server.use(
    http.get("*/api/sessions/:id/articles/:slug", ({ params }) => {
      calls++;
      return HttpResponse.json({
        id: "art-1",
        sessionId: params.id,
        slug: params.slug,
        name: `v-${calls}`,
        contentMd: "# Hello\n\nBody.\n",
        createdAt: new Date().toISOString(),
        heading: "Hello",
      });
    }),
  );
  return () => calls;
};

// Serve a run article whose name encodes the fetch count, so a refetch is
// observable as the rendered name advancing v-1 → v-2 → …
const serveCountingRunDetail = () => {
  let calls = 0;
  server.use(
    http.get("*/api/runs/:id/articles/:slug", ({ params }) => {
      calls++;
      return HttpResponse.json({
        id: "art-1",
        runId: params.id,
        slug: params.slug,
        name: `v-${calls}`,
        contentMd: "# Hello\n\nBody.\n",
        createdAt: new Date().toISOString(),
        workflowName: "briefing",
        heading: "Hello",
        gitSha: null,
        gitDirty: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      });
    }),
  );
  return () => calls;
};

// Serve a session article list whose only row's slug encodes the fetch count.
const serveCountingList = () => {
  let calls = 0;
  server.use(
    http.get("*/api/sessions/:id/articles", () => {
      calls++;
      return HttpResponse.json({
        articles: [
          {
            slug: `a-${calls}`,
            name: "Notes",
            heading: null,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    }),
  );
};

describe("articles state", () => {
  it("fetches and exposes a single article by run id and slug", async () => {
    server.use(
      http.get("*/api/runs/:id/articles/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          slug: params.slug,
          name: "Morning Briefing",
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

  it("refetches a mounted session article when its write is announced", async () => {
    serveCountingDetail();
    const { source } = renderLive(<DetailProbe sessionId="s1" slug="notes" />);
    expect(await screen.findByText("v-1")).toBeDefined();

    act(() => source().emit({ type: "article.written", sessionId: "s1", slug: "notes" }));

    expect(await screen.findByText("v-2")).toBeDefined();
  });

  it("marks an unmounted article stale so returning to it refetches", async () => {
    serveCountingDetail();
    const { wrap, rerender, source } = renderLive(<DetailProbe sessionId="s1" slug="notes" />);
    expect(await screen.findByText("v-1")).toBeDefined();

    // Navigate away: the detail unmounts but its cache entry stays. The write
    // announced while it's gone must still stale the cache, so coming back
    // refetches rather than serving the old body forever.
    rerender(wrap(null));
    act(() => source().emit({ type: "article.written", sessionId: "s1", slug: "notes" }));
    rerender(wrap(<DetailProbe sessionId="s1" slug="notes" />));

    expect(await screen.findByText("v-2")).toBeDefined();
  });

  it("refetches the session's article list on any of its writes", async () => {
    serveCountingList();
    const { source } = renderLive(<ListProbe sessionId="s1" />);
    expect(await screen.findByText("a-1")).toBeDefined();

    act(() => source().emit({ type: "article.written", sessionId: "s1", slug: "whatever" }));

    expect(await screen.findByText("a-2")).toBeDefined();
  });

  it("does not refetch on another session's writes", async () => {
    const calls = serveCountingDetail();
    const { source } = renderLive(<DetailProbe sessionId="s1" slug="notes" />);
    expect(await screen.findByText("v-1")).toBeDefined();

    act(() => source().emit({ type: "article.written", sessionId: "other", slug: "notes" }));
    act(() => source().emit({ type: "article.written", sessionId: "s1", slug: "other-slug" }));
    await flushAsync();

    expect(screen.getByText("v-1")).toBeDefined();
    expect(calls()).toBe(1);
  });

  it("re-syncs session article queries on event-stream reconnect", async () => {
    serveCountingDetail();
    const { source } = renderLive(<DetailProbe sessionId="s1" slug="notes" />);
    expect(await screen.findByText("v-1")).toBeDefined();

    // The first open is the initial connect; the second is a reconnect, which
    // must re-sync anything missed while disconnected.
    act(() => source().triggerOpen());
    act(() => source().triggerOpen());

    expect(await screen.findByText("v-2")).toBeDefined();
  });

  it("refetches a mounted run article when its run finishes", async () => {
    serveCountingRunDetail();
    const { source } = renderLive(<Probe runId="run-1" slug="briefing" />);
    expect(await screen.findByText("v-1")).toBeDefined();

    act(() => source().emit({ type: "run.finished", id: "run-1", status: "ok" }));

    expect(await screen.findByText("v-2")).toBeDefined();
  });

  it("marks an unmounted run article stale so returning after a rerun refetches", async () => {
    serveCountingRunDetail();
    const { wrap, rerender, source } = renderLive(<Probe runId="run-1" slug="briefing" />);
    expect(await screen.findByText("v-1")).toBeDefined();

    // Navigate away, rerun the run, come back: a rerun rewrites the articles
    // under the same run id, so the revisit must refetch rather than serve
    // the pre-rerun body from cache.
    rerender(wrap(null));
    act(() => source().emit({ type: "run.finished", id: "run-1", status: "ok" }));
    rerender(wrap(<Probe runId="run-1" slug="briefing" />));

    expect(await screen.findByText("v-2")).toBeDefined();
  });

  it("restales a run's article when the run is deleted", async () => {
    serveCountingRunDetail();
    const { source } = renderLive(<Probe runId="run-1" slug="briefing" />);
    expect(await screen.findByText("v-1")).toBeDefined();

    act(() => source().emit({ type: "run.deleted", id: "run-1" }));

    expect(await screen.findByText("v-2")).toBeDefined();
  });

  it("does not refetch a run article on another run's lifecycle", async () => {
    const calls = serveCountingRunDetail();
    const { source } = renderLive(<Probe runId="run-1" slug="briefing" />);
    expect(await screen.findByText("v-1")).toBeDefined();

    act(() => source().emit({ type: "run.finished", id: "other", status: "ok" }));
    act(() => source().emit({ type: "run.deleted", id: "other" }));
    await flushAsync();

    expect(screen.getByText("v-1")).toBeDefined();
    expect(calls()).toBe(1);
  });

  it("re-syncs run article queries on event-stream reconnect", async () => {
    serveCountingRunDetail();
    const { source } = renderLive(<Probe runId="run-1" slug="briefing" />);
    expect(await screen.findByText("v-1")).toBeDefined();

    act(() => source().triggerOpen());
    act(() => source().triggerOpen());

    expect(await screen.findByText("v-2")).toBeDefined();
  });
});
