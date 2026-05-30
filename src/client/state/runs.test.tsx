import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { createQueryClient } from "./query-client.ts";
import {
  useRun,
  useRunFeedsLive,
  useRunWindowsLive,
  useRunsLive,
  useWorkflowRunFeed,
  useWorkflowRunWindow,
} from "./runs.ts";

const runPayload = (id: string, workflowName: string) => ({
  run: {
    id,
    workflowName,
    status: "ok",
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: "2026-05-09T12:00:01.000Z",
    error: null,
    summary: null,
    definitionSnapshot: { name: workflowName, steps: [] },
    isInterrupted: false,
    articles: [],
    recommendations: [],
  },
  steps: [],
});

const Probe = ({ id }: { id: string }) => {
  useRunsLive();
  const { data } = useRun(id);
  return <p>{data ? data.run.workflowName : "loading"}</p>;
};

const renderProbe = (id = "r1") => {
  const { factory, sources } = captureEventSources();
  const ui = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <Probe id={id} />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...ui, sources };
};

// Serve a run whose workflowName encodes the fetch count, so a refetch is
// observable as the rendered name advancing wf-1 → wf-2 → …
const serveCountingRun = () => {
  let calls = 0;
  server.use(
    http.get("*/api/runs/:id", () => {
      calls++;
      return HttpResponse.json(runPayload("r1", `wf-${calls}`));
    }),
  );
  return () => calls;
};

describe("runs state", () => {
  it("fetches and exposes a run's detail", async () => {
    server.use(http.get("*/api/runs/:id", () => HttpResponse.json(runPayload("r1", "deploy"))));
    renderProbe("r1");
    expect(await screen.findByText("deploy")).toBeDefined();
  });

  it("refetches the run on its own lifecycle events", async () => {
    serveCountingRun();
    const { sources } = renderProbe("r1");
    await screen.findByText("wf-1");

    act(() => sources[0]?.emit({ type: "run.updated", id: "r1", status: "ok" }));
    await screen.findByText("wf-2");

    act(() => sources[0]?.emit({ type: "run.step.updated", runId: "r1", step: 0, status: "ok" }));
    await screen.findByText("wf-3");

    act(() =>
      sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok", workflowName: "x" }),
    );
    await screen.findByText("wf-4");
  });

  it("refetches on recommendation events that name the run", async () => {
    serveCountingRun();
    const { sources } = renderProbe("r1");
    await screen.findByText("wf-1");

    act(() =>
      sources[0]?.emit({
        type: "recommendation.actioned",
        runId: "r1",
        recommendationId: "rec",
        actionedRunId: "s1",
      }),
    );
    await screen.findByText("wf-2");

    act(() =>
      sources[0]?.emit({
        type: "recommendation.updated",
        runId: "r1",
        recommendationId: "rec",
        actionedRunId: "s1",
        status: "ok",
      }),
    );
    await screen.findByText("wf-3");
  });

  it("ignores events that name a different run", async () => {
    const callCount = serveCountingRun();
    const { sources } = renderProbe("r1");
    await screen.findByText("wf-1");

    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "other", status: "ok" });
      sources[0]?.emit({
        type: "recommendation.updated",
        runId: "other",
        recommendationId: "rec",
        actionedRunId: "s",
        status: "ok",
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByText("wf-1")).toBeDefined();
    expect(callCount()).toBe(1);
  });

  it("recovers mounted runs on event-stream reconnect", async () => {
    const callCount = serveCountingRun();
    const { sources } = renderProbe("r1");
    await screen.findByText("wf-1");

    // First open is the initial connect (silent); the second is a reconnect.
    act(() => sources[0]?.triggerOpen());
    expect(callCount()).toBe(1);

    act(() => sources[0]?.triggerOpen());
    await screen.findByText("wf-2");
  });
});

const WindowProbe = ({ workflow }: { workflow: string }) => {
  useRunWindowsLive();
  const { data } = useWorkflowRunWindow(workflow, 14);
  return <p>{data ? `count:${data.length}` : "loading"}</p>;
};

const renderWindowProbe = (workflow = "deploy") => {
  const { factory, sources } = captureEventSources();
  const ui = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <WindowProbe workflow={workflow} />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...ui, sources };
};

// Serve a run window whose length encodes the fetch count, so a refetch is
// observable as the rendered count advancing 1 → 2 → …
const serveCountingWindow = () => {
  let calls = 0;
  server.use(
    http.get("*/api/runs", () => {
      calls++;
      return HttpResponse.json({
        runs: Array.from({ length: calls }, (_, i) => ({ id: `r${i}` })),
        nextCursor: null,
      });
    }),
  );
  return () => calls;
};

describe("run window state", () => {
  it("fetches a workflow's recent run window scoped to that workflow", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get("*/api/runs", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("workflow"));
        return HttpResponse.json({ runs: [{ id: "a" }, { id: "b" }], nextCursor: null });
      }),
    );
    renderWindowProbe("deploy");
    expect(await screen.findByText("count:2")).toBeDefined();
    expect(seen).toEqual(["deploy"]);
  });

  it("refetches the window on run lifecycle events", async () => {
    serveCountingWindow();
    const { sources } = renderWindowProbe("deploy");
    await screen.findByText("count:1");

    act(() => sources[0]?.emit({ type: "run.started", id: "r9" }));
    await screen.findByText("count:2");

    act(() =>
      sources[0]?.emit({ type: "run.finished", id: "r9", status: "ok", workflowName: "deploy" }),
    );
    await screen.findByText("count:3");

    act(() => sources[0]?.emit({ type: "run.deleted", id: "r9" }));
    await screen.findByText("count:4");
  });

  it("recovers the window on event-stream reconnect", async () => {
    const callCount = serveCountingWindow();
    const { sources } = renderWindowProbe("deploy");
    await screen.findByText("count:1");

    // First open is the initial connect (silent); the second is a reconnect.
    act(() => sources[0]?.triggerOpen());
    expect(callCount()).toBe(1);

    act(() => sources[0]?.triggerOpen());
    await screen.findByText("count:2");
  });
});

const FeedProbe = ({ workflow }: { workflow: string }) => {
  useRunFeedsLive();
  const feed = useWorkflowRunFeed(workflow);
  return (
    <div>
      <p>{feed.data ? `count:${feed.data.length}` : "loading"}</p>
      <p>{feed.hasNextPage ? "more" : "end"}</p>
      <button type="button" onClick={() => void feed.fetchNextPage()}>
        next
      </button>
    </div>
  );
};

const renderFeedProbe = (workflow = "deploy") => {
  const { factory, sources } = captureEventSources();
  const ui = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <FeedProbe workflow={workflow} />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...ui, sources };
};

// Serve a feed whose first-page length encodes the fetch count, so a refetch
// is observable as the rendered count advancing 1 → 2 → … Only the first page
// (no cursor) is counted; loaded pages refetch from page one on invalidation.
const serveCountingFeed = () => {
  let calls = 0;
  server.use(
    http.get("*/api/runs", () => {
      calls++;
      return HttpResponse.json({
        runs: Array.from({ length: calls }, (_, i) => ({ id: `r${i}` })),
        nextCursor: null,
      });
    }),
  );
  return () => calls;
};

describe("run feed state", () => {
  it("fetches a workflow's run feed scoped to that workflow", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get("*/api/runs", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("workflow"));
        return HttpResponse.json({ runs: [{ id: "a" }, { id: "b" }], nextCursor: null });
      }),
    );
    renderFeedProbe("deploy");
    expect(await screen.findByText("count:2")).toBeDefined();
    expect(seen).toEqual(["deploy"]);
  });

  it("loads further pages on demand, advancing by the cursor", async () => {
    server.use(
      http.get("*/api/runs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor === null) {
          return HttpResponse.json({ runs: [{ id: "r1" }], nextCursor: "r1" });
        }
        return HttpResponse.json({ runs: [{ id: "r2" }], nextCursor: null });
      }),
    );
    renderFeedProbe("deploy");
    await screen.findByText("count:1");
    expect(screen.getByText("more")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "next" }));

    await screen.findByText("count:2");
    expect(screen.getByText("end")).toBeDefined();
  });

  it("refetches the feed on run lifecycle events", async () => {
    serveCountingFeed();
    const { sources } = renderFeedProbe("deploy");
    await screen.findByText("count:1");

    act(() => sources[0]?.emit({ type: "run.started", id: "r9" }));
    await screen.findByText("count:2");

    act(() =>
      sources[0]?.emit({ type: "run.finished", id: "r9", status: "ok", workflowName: "deploy" }),
    );
    await screen.findByText("count:3");

    act(() => sources[0]?.emit({ type: "run.deleted", id: "r9" }));
    await screen.findByText("count:4");
  });

  it("recovers the feed on event-stream reconnect", async () => {
    const callCount = serveCountingFeed();
    const { sources } = renderFeedProbe("deploy");
    await screen.findByText("count:1");

    // First open is the initial connect (silent); the second is a reconnect.
    act(() => sources[0]?.triggerOpen());
    expect(callCount()).toBe(1);

    act(() => sources[0]?.triggerOpen());
    await screen.findByText("count:2");
  });
});
