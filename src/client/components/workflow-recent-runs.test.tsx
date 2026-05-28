import { afterEach, describe, expect, it } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { FakeIntersectionObserver } from "../../../tests/setup/fake-intersection-observer.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { WorkflowRecentRuns } from "./workflow-recent-runs.tsx";

afterEach(() => {
  FakeIntersectionObserver.reset();
});

const WORKFLOW = "dev-patch";

const renderRecentRuns = (workflowName = WORKFLOW) => {
  const { hook } = memoryLocation({ path: `/workflows/${workflowName}` });
  const { factory, sources } = captureEventSources();
  const ui = render(
    <Router hook={hook}>
      <LiveEventsProvider factory={factory}>
        <WorkflowRecentRuns workflowName={workflowName} />
      </LiveEventsProvider>
    </Router>,
  );
  return { ...ui, sources };
};

// Shape of a run row as the API returns it. `inputs.repo` becomes the
// row's headline under the workflow variant, so it doubles as a handle
// for asserting which runs are on the feed.
const runPayload = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  workflowName: WORKFLOW,
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:01.000Z",
  error: null,
  summary: null,
  definitionSnapshot: { name: WORKFLOW, steps: [] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
  ...overrides,
});

const detailOf = (overrides: Record<string, unknown> = {}) => ({
  run: { ...runPayload(overrides), recommendations: [] },
  steps: [],
});

describe("<WorkflowRecentRuns>", () => {
  it("shows a loading message while the first page is being fetched", async () => {
    renderRecentRuns();
    expect(screen.getByText(/loading runs/i)).toBeDefined();
    await flushAsync();
  });

  it("scopes the feed fetch to its workflow and renders the runs as feed rows", async () => {
    const seenWorkflow: (string | null)[] = [];
    server.use(
      http.get("*/api/runs", ({ request }) => {
        seenWorkflow.push(new URL(request.url).searchParams.get("workflow"));
        return HttpResponse.json({
          runs: [runPayload({ id: "r1", inputs: { repo: "autoid-verify-service" } })],
          nextCursor: null,
        });
      }),
    );

    renderRecentRuns();

    const row = await screen.findByRole("link", { name: /autoid-verify-service/i });
    expect(row.getAttribute("href")).toBe("/runs/r1");
    expect(seenWorkflow).toEqual([WORKFLOW]);
  });

  it("shows the empty state when the workflow has no runs", async () => {
    renderRecentRuns();
    expect(await screen.findByText(/no runs yet/i)).toBeDefined();
  });

  it("surfaces fetch failures via an alert", async () => {
    server.use(http.get("*/api/runs", () => new HttpResponse("boom", { status: 500 })));
    renderRecentRuns();

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load runs/i);
  });

  it("prepends a freshly-started run that belongs to this workflow", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [runPayload({ id: "r1", inputs: { repo: "kept-repo" } })],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/r-new", () =>
        HttpResponse.json(
          detailOf({
            id: "r-new",
            status: "running",
            finishedAt: null,
            inputs: { repo: "fresh-repo" },
          }),
        ),
      ),
    );

    const { sources } = renderRecentRuns();
    await screen.findByText("kept-repo");

    act(() => sources[0]?.emit({ type: "run.started", id: "r-new" }));

    await screen.findByText("fresh-repo");
  });

  it("ignores a run.started event for a different workflow", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [runPayload({ id: "r1", inputs: { repo: "kept-repo" } })],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/r-other", () =>
        HttpResponse.json(
          detailOf({ id: "r-other", workflowName: "other-wf", inputs: { repo: "other-repo" } }),
        ),
      ),
    );

    const { sources } = renderRecentRuns();
    await screen.findByText("kept-repo");

    act(() => sources[0]?.emit({ type: "run.started", id: "r-other" }));
    await flushAsync();

    // The fetch resolved, but the run belongs to another workflow so it
    // is not prepended onto this feed.
    expect(screen.queryByText("other-repo")).toBeNull();
    expect(screen.getByText("kept-repo")).toBeDefined();
  });

  it("logs and drops the prepend when the single-row fetch fails", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [runPayload({ inputs: { repo: "kept-repo" } })],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/missing", () =>
        HttpResponse.json({ error: 'run "missing" not found' }, { status: 404 }),
      ),
    );

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };
    try {
      const { sources } = renderRecentRuns();
      await screen.findByText("kept-repo");
      act(() => sources[0]?.emit({ type: "run.started", id: "missing" }));
      await waitFor(() =>
        expect(errors.some((line) => line.includes("run.started fetch failed"))).toBe(true),
      );
    } finally {
      console.error = originalError;
    }
  });

  it("patches a loaded run in place on run.finished for this workflow", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [runPayload({ id: "r1", status: "running", finishedAt: null })],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/r1", () => HttpResponse.json(detailOf({ id: "r1", status: "ok" }))),
    );

    const { sources, container } = renderRecentRuns();
    await waitFor(() => expect(container.querySelector('[data-status="running"]')).not.toBeNull());

    act(() =>
      sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok", workflowName: WORKFLOW }),
    );

    await waitFor(() => expect(container.querySelector('[data-status="ok"]')).not.toBeNull());
  });

  it("skips the round-trip for a run.finished from another workflow", async () => {
    let detailFetches = 0;
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({ runs: [runPayload({ id: "r1" })], nextCursor: null }),
      ),
      http.get("*/api/runs/r1", () => {
        detailFetches++;
        return HttpResponse.json(detailOf({ id: "r1" }));
      }),
    );

    const { sources } = renderRecentRuns();
    await flushAsync();

    act(() =>
      sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok", workflowName: "other-wf" }),
    );
    await flushAsync();

    // The name in the payload doesn't match, so no detail fetch is made.
    expect(detailFetches).toBe(0);
  });

  it("fetches and patches on run.updated, no-op when the run isn't loaded", async () => {
    let detailFetches = 0;
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [runPayload({ id: "r1", inputs: { repo: "kept-repo" } })],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/r-other", () => {
        detailFetches++;
        return HttpResponse.json(detailOf({ id: "r-other", inputs: { repo: "other-repo" } }));
      }),
    );

    const { sources } = renderRecentRuns();
    await screen.findByText("kept-repo");

    act(() => sources[0]?.emit({ type: "run.updated", id: "r-other", status: "ok" }));

    // The fetch fires (the payload carries no name to filter on), but the
    // patch is a no-op since the run isn't on a loaded page.
    await waitFor(() => expect(detailFetches).toBe(1));
    expect(screen.queryByText("other-repo")).toBeNull();
  });

  it("logs and drops the patch when the single-row fetch fails", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [runPayload({ id: "r1", status: "running", finishedAt: null })],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/r1", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };
    try {
      const { sources } = renderRecentRuns();
      await flushAsync();
      act(() =>
        sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok", workflowName: WORKFLOW }),
      );
      await waitFor(() =>
        expect(errors.some((line) => line.includes("run.updated fetch failed"))).toBe(true),
      );
    } finally {
      console.error = originalError;
    }
  });

  it("drops a row in place on run.deleted", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [
            runPayload({ id: "r1", inputs: { repo: "alpha-repo" } }),
            runPayload({ id: "r2", inputs: { repo: "beta-repo" } }),
          ],
          nextCursor: null,
        }),
      ),
    );

    const { sources } = renderRecentRuns();
    await screen.findByText("alpha-repo");

    act(() => sources[0]?.emit({ type: "run.deleted", id: "r1" }));

    await waitFor(() => expect(screen.queryByText("alpha-repo")).toBeNull());
    expect(screen.getByText("beta-repo")).toBeDefined();
  });

  it("refetches page one and merges on SSE reconnect", async () => {
    let pageOneCalls = 0;
    server.use(
      http.get("*/api/runs", () => {
        pageOneCalls++;
        if (pageOneCalls === 1) {
          return HttpResponse.json({
            runs: [runPayload({ id: "r1", inputs: { repo: "first-repo" } })],
            nextCursor: null,
          });
        }
        return HttpResponse.json({
          runs: [
            runPayload({ id: "r0", inputs: { repo: "merged-repo" } }),
            runPayload({ id: "r1", inputs: { repo: "first-repo" } }),
          ],
          nextCursor: null,
        });
      }),
    );

    const { sources } = renderRecentRuns();
    await screen.findByText("first-repo");
    // The initial open is not a reconnect.
    act(() => sources[0]?.triggerOpen());
    expect(pageOneCalls).toBe(1);

    act(() => sources[0]?.triggerOpen());
    await screen.findByText("merged-repo");
    expect(pageOneCalls).toBe(2);
  });

  it("loads the next page when the sentinel intersects", async () => {
    server.use(
      http.get("*/api/runs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor === null) {
          return HttpResponse.json({
            runs: [runPayload({ id: "r1", inputs: { repo: "page-one-repo" } })],
            nextCursor: "r1",
          });
        }
        return HttpResponse.json({
          runs: [runPayload({ id: "r2", inputs: { repo: "page-two-repo" } })],
          nextCursor: null,
        });
      }),
    );

    renderRecentRuns();
    await screen.findByText("page-one-repo");
    expect(screen.queryByText("page-two-repo")).toBeNull();

    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected an IntersectionObserver to be registered");
    act(() => observer.triggerIntersect());

    await screen.findByText("page-two-repo");
    expect(screen.getByText(/end of feed/i)).toBeDefined();
  });
});
