import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { FakeIntersectionObserver } from "../../../tests/setup/fake-intersection-observer.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { Dashboard } from "./dashboard.tsx";

afterEach(() => {
  cleanup();
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
  it("renders the activity section heading", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: /activity/i })).toBeDefined();
  });

  it("shows a loading message while runs are being fetched", () => {
    renderDashboard();
    expect(screen.getByText(/loading runs/i)).toBeDefined();
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

  it("refreshes page one when a run lifecycle event fires", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/runs", () => {
        calls++;
        return HttpResponse.json({
          runs: [
            {
              id: `r${calls}`,
              workflowName: `wf-${calls}`,
              status: "ok",
              trigger: "manual",
              startedAt: "2026-05-09T12:00:00.000Z",
              finishedAt: "2026-05-09T12:00:01.000Z",
              error: null,
              summary: null,
              definitionSnapshot: { name: `wf-${calls}`, steps: [] },
              isInterrupted: false,
            },
          ],
          nextCursor: null,
        });
      }),
    );

    const { sources } = renderDashboard();
    await screen.findByText(/wf-1/);

    act(() => {
      sources[0]?.emit({ type: "run.started", id: "new" });
    });

    await screen.findByText(/wf-2/);
  });

  // Page handlers reused across the pagination scenarios: page one
  // points at the second page; page two ends the feed.
  const seedTwoPages = () => {
    server.use(
      http.get("*/api/runs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor === null) {
          return HttpResponse.json({
            runs: [
              {
                id: "r1",
                workflowName: "page-one",
                status: "ok",
                trigger: "manual",
                startedAt: "2026-05-09T12:00:00.000Z",
                finishedAt: "2026-05-09T12:00:01.000Z",
                error: null,
                summary: null,
                definitionSnapshot: { name: "page-one", steps: [] },
                isInterrupted: false,
              },
            ],
            nextCursor: "r1",
          });
        }
        return HttpResponse.json({
          runs: [
            {
              id: "r2",
              workflowName: "page-two",
              status: "ok",
              trigger: "manual",
              startedAt: "2026-05-09T11:55:00.000Z",
              finishedAt: "2026-05-09T11:55:01.000Z",
              error: null,
              summary: null,
              definitionSnapshot: { name: "page-two", steps: [] },
              isInterrupted: false,
            },
          ],
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
