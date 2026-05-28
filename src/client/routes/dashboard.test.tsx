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
import { Dashboard } from "./dashboard.tsx";

afterEach(() => {
  FakeIntersectionObserver.reset();
});

const renderDashboard = () => {
  const { hook } = memoryLocation({ path: "/" });
  const { factory, sources } = captureEventSources();
  const ui = render(
    <Router hook={hook}>
      <LiveEventsProvider factory={factory}>
        <Dashboard />
      </LiveEventsProvider>
    </Router>,
  );
  return { ...ui, sources };
};

describe("<Dashboard>", () => {
  it("renders the activity section heading", async () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: /activity/i })).toBeDefined();
    await flushAsync();
  });

  it("shows a loading message while runs are being fetched", async () => {
    renderDashboard();
    expect(screen.getByText(/loading runs/i)).toBeDefined();
    await flushAsync();
  });

  it("delegates rendering to the activity feed once runs load", async () => {
    renderDashboard();
    expect(await screen.findByText(/no runs yet/i)).toBeDefined();
  });

  it("surfaces fetch failures via an alert", async () => {
    server.use(http.get("*/api/runs", () => new HttpResponse("boom", { status: 500 })));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load runs/i);
  });

  // Shape of a run row as the API returns it (and as our MSW handlers
  // assemble it). Local helper to keep the test handlers readable.
  const stubRunPayload = (
    id: string,
    workflowName: string,
    status = "ok",
    articles: Array<{ name: string; title: string; createdAt: string }> = [],
  ) => ({
    id,
    workflowName,
    status,
    trigger: "manual",
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-05-09T12:00:01.000Z",
    error: null,
    summary: null,
    definitionSnapshot: { name: workflowName, steps: [] },
    isInterrupted: false,
    articles,
  });

  it("prepends a freshly-started run via a single-row fetch on run.started", async () => {
    let pageOneCalls = 0;
    server.use(
      http.get("*/api/runs", () => {
        pageOneCalls++;
        return HttpResponse.json({
          runs: [stubRunPayload("r1", "old-wf")],
          nextCursor: null,
        });
      }),
      http.get("*/api/runs/r-new", () =>
        HttpResponse.json({
          run: stubRunPayload("r-new", "fresh-wf", "running"),
          steps: [],
        }),
      ),
    );

    const { sources } = renderDashboard();
    await screen.findByText(/old-wf/);
    expect(pageOneCalls).toBe(1);

    act(() => sources[0]?.emit({ type: "run.started", id: "r-new" }));

    await screen.findByText(/fresh-wf/);
    // Crucially: no second page-one fetch — the prepend was surgical.
    expect(pageOneCalls).toBe(1);
  });

  it("patches a loaded run in place on run.finished", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [stubRunPayload("r1", "wf", "running")],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/r1", () =>
        HttpResponse.json({
          run: stubRunPayload("r1", "wf", "ok"),
          steps: [],
        }),
      ),
    );

    const { sources, container } = renderDashboard();
    await waitFor(() => {
      expect(container.querySelector('[data-status="running"]')).not.toBeNull();
    });

    act(() => {
      sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok", workflowName: "wf" });
    });

    await waitFor(() => {
      expect(container.querySelector('[data-status="ok"]')).not.toBeNull();
    });
  });

  it("drops a row in place on run.deleted (no refetch)", async () => {
    let pageOneCalls = 0;
    server.use(
      http.get("*/api/runs", () => {
        pageOneCalls++;
        return HttpResponse.json({
          runs: [stubRunPayload("r1", "alpha"), stubRunPayload("r2", "beta")],
          nextCursor: null,
        });
      }),
    );

    const { sources } = renderDashboard();
    await screen.findByText(/alpha/);
    await screen.findByText(/beta/);
    expect(pageOneCalls).toBe(1);

    act(() => sources[0]?.emit({ type: "run.deleted", id: "r1" }));

    await waitFor(() => {
      expect(screen.queryByText(/alpha/)).toBeNull();
    });
    expect(screen.getByText(/beta/)).toBeDefined();
    // Surgical: deletion did not retrigger the page-one fetch.
    expect(pageOneCalls).toBe(1);
  });

  it("ignores a run.deleted event for a row that isn't on any loaded page", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({ runs: [stubRunPayload("r1", "alpha")], nextCursor: null }),
      ),
    );

    const { sources } = renderDashboard();
    await screen.findByText(/alpha/);

    act(() => sources[0]?.emit({ type: "run.deleted", id: "unknown" }));

    // Untouched: the loaded row is still rendered.
    expect(screen.getByText(/alpha/)).toBeDefined();
  });

  it("reconciles article chips when a run goes from 0 to N articles mid-stream", async () => {
    // First page-one fetch carries no articles. After a run.updated event
    // the dashboard refetches the single run; the detail endpoint now
    // returns articles on run.articles, and the feed row patches in place
    // to show the chip without a page-one reload.
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [stubRunPayload("r1", "with-publish", "running")],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/r1", () =>
        HttpResponse.json({
          run: stubRunPayload("r1", "with-publish", "ok", [
            { name: "digest", title: "PR Review Digest", createdAt: "2026-05-09T12:00:30.000Z" },
          ]),
          steps: [],
        }),
      ),
    );

    const { sources } = renderDashboard();
    await screen.findByText(/with-publish/);
    // No chip yet — the initial page-one payload carried no articles.
    expect(screen.queryByRole("link", { name: /^PR Review Digest$/ })).toBeNull();

    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "r1", status: "running" });
    });

    // The refetched run now ships an article on run.articles; the chip
    // surfaces without a page-one reload.
    const chip = await screen.findByRole("link", { name: /^PR Review Digest$/ });
    expect(chip.getAttribute("href")).toBe("/runs/r1/published/digest");
  });

  it("ignores a run.updated event for a row that isn't on any loaded page", async () => {
    let detailFetches = 0;
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [stubRunPayload("r1", "wf")],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/r-other", () => {
        detailFetches++;
        return HttpResponse.json({
          run: stubRunPayload("r-other", "other-wf", "ok"),
          steps: [],
        });
      }),
    );

    const { sources } = renderDashboard();
    await screen.findByText(/^wf$/);

    act(() => {
      sources[0]?.emit({
        type: "run.updated",
        id: "r-other",
        status: "ok",
      });
    });

    // The fetch happens (we don't know yet whether the row is loaded
    // until the response arrives), but the patch is a no-op.
    await waitFor(() => expect(detailFetches).toBe(1));
    expect(screen.queryByText(/other-wf/)).toBeNull();
  });

  it("refetches page one and merges by id on SSE reconnect", async () => {
    let pageOneCalls = 0;
    server.use(
      http.get("*/api/runs", () => {
        pageOneCalls++;
        if (pageOneCalls === 1) {
          return HttpResponse.json({
            runs: [stubRunPayload("r1", "wf-1")],
            nextCursor: null,
          });
        }
        return HttpResponse.json({
          runs: [stubRunPayload("r0", "fresh-wf"), stubRunPayload("r1", "wf-1")],
          nextCursor: null,
        });
      }),
    );

    const { sources } = renderDashboard();
    await screen.findByText(/wf-1/);
    // Initial open doesn't count as a reconnect.
    act(() => sources[0]?.triggerOpen());
    expect(pageOneCalls).toBe(1);

    act(() => sources[0]?.triggerOpen());
    await screen.findByText(/fresh-wf/);
    expect(pageOneCalls).toBe(2);
  });

  it("logs and drops the prepend when the single-row fetch fails", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({ runs: [stubRunPayload("r1", "wf")], nextCursor: null }),
      ),
      http.get("*/api/runs/missing", () =>
        HttpResponse.json({ error: 'run "missing" not found' }, { status: 404 }),
      ),
    );

    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };

    try {
      const { sources } = renderDashboard();
      await screen.findByText(/wf/);
      act(() => sources[0]?.emit({ type: "run.started", id: "missing" }));
      await waitFor(() =>
        expect(errors.some((line) => String(line).includes("run.started fetch failed"))).toBe(true),
      );
    } finally {
      console.error = originalError;
    }
  });

  it("logs and drops the patch when the single-row fetch fails", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json({
          runs: [stubRunPayload("r1", "wf", "running")],
          nextCursor: null,
        }),
      ),
      http.get("*/api/runs/r1", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );

    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };

    try {
      const { sources } = renderDashboard();
      await screen.findByText(/wf/);
      act(() => {
        sources[0]?.emit({ type: "run.finished", id: "r1", status: "ok", workflowName: "wf" });
      });
      await waitFor(() =>
        expect(errors.some((line) => String(line).includes("run.updated fetch failed"))).toBe(true),
      );
    } finally {
      console.error = originalError;
    }
  });

  // Page handlers reused across the pagination scenarios: page one
  // points at the second page; page two ends the feed.
  const seedTwoPages = () => {
    server.use(
      http.get("*/api/runs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor === null) {
          return HttpResponse.json({
            runs: [stubRunPayload("r1", "page-one")],
            nextCursor: "r1",
          });
        }
        return HttpResponse.json({
          runs: [stubRunPayload("r2", "page-two")],
          nextCursor: null,
        });
      }),
    );
  };

  it("loads the next page when the sentinel intersects", async () => {
    seedTwoPages();
    renderDashboard();
    await screen.findByText(/page-one/);
    expect(screen.queryByText(/page-two/)).toBeNull();

    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected an IntersectionObserver to be registered");
    act(() => observer.triggerIntersect());

    await screen.findByText(/page-two/);
    expect(screen.getByText(/end of feed/i)).toBeDefined();
  });

  it("shows the end-of-feed indicator immediately when the first page is the last", async () => {
    renderDashboard();
    await screen.findByText(/no runs yet/i);
    // An empty feed renders the empty-state sentence, not an end-of-feed
    // indicator — both convey the same thing but the empty-state copy
    // is more readable.
    expect(screen.queryByText(/end of feed/i)).toBeNull();
  });
});
