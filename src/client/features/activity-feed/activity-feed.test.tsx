import { afterEach, describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FakeIntersectionObserver } from "../../../../tests/setup/fake-intersection-observer.ts";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { ActivityFeed } from "./activity-feed.tsx";

afterEach(() => {
  FakeIntersectionObserver.reset();
});

const NOW = new Date("2026-05-09T12:03:00.000Z");

const feedRun = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  workflowName: "deploy",
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:01.000Z",
  error: null,
  summary: null,
  definitionSnapshot: { name: "deploy", steps: [] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
  ...over,
});

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  status: "idle",
  model: "anthropic:claude",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: null,
  error: null,
  preview: "all-session",
  ...over,
});

const renderActivity = (path = "/") =>
  render(
    <Router hook={memoryLocation({ path }).hook}>
      <QueryClientProvider client={createQueryClient()}>
        <ActivityFeed now={NOW} />
      </QueryClientProvider>
    </Router>,
  );

describe("<ActivityFeed>", () => {
  it("defaults to the All view, blending runs and sessions", async () => {
    server.use(
      http.get("*/api/activity", () =>
        HttpResponse.json({
          entries: [
            { kind: "run", run: feedRun({ workflowName: "deploy" }) },
            { kind: "session", session: sessionRow({ preview: "all-session" }) },
          ],
          nextCursor: null,
        }),
      ),
    );
    renderActivity();

    expect(await screen.findByRole("link", { name: "deploy" })).toBeDefined();
    expect(screen.getByRole("link", { name: /all-session/i }).getAttribute("href")).toBe(
      "/sessions/s1",
    );
  });

  it("filters to runs on the Workflows tab", async () => {
    let runsHit = false;
    server.use(
      http.get("*/api/activity", () => HttpResponse.json({ entries: [], nextCursor: null })),
      http.get("*/api/runs", () => {
        runsHit = true;
        return HttpResponse.json({
          runs: [feedRun({ workflowName: "wf-runs" })],
          nextCursor: null,
        });
      }),
    );
    const user = userEvent.setup();
    renderActivity();

    await user.click(await screen.findByRole("tab", { name: /workflows/i }));
    expect(await screen.findByRole("link", { name: "wf-runs" })).toBeDefined();
    expect(runsHit).toBe(true);
  });

  it("filters to sessions on the Sessions tab", async () => {
    server.use(
      http.get("*/api/activity", () => HttpResponse.json({ entries: [], nextCursor: null })),
      http.get("*/api/sessions", () =>
        HttpResponse.json({
          sessions: [sessionRow({ preview: "sessions-tab" })],
          nextCursor: null,
        }),
      ),
    );
    const user = userEvent.setup();
    renderActivity();

    await user.click(await screen.findByRole("tab", { name: /sessions/i }));
    expect(await screen.findByRole("link", { name: /sessions-tab/i })).toBeDefined();
  });

  it("loads the next page of the All feed when the sentinel intersects", async () => {
    server.use(
      http.get("*/api/activity", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        return cursor
          ? HttpResponse.json({
              entries: [{ kind: "run", run: feedRun({ id: "r2", workflowName: "page-two" }) }],
              nextCursor: null,
            })
          : HttpResponse.json({
              entries: [{ kind: "run", run: feedRun({ id: "r1", workflowName: "page-one" }) }],
              nextCursor: "c1",
            });
      }),
    );
    renderActivity();

    expect(await screen.findByRole("link", { name: "page-one" })).toBeDefined();
    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected the sentinel to register an observer");
    act(() => observer.triggerIntersect());

    expect(await screen.findByRole("link", { name: "page-two" })).toBeDefined();
  });

  it("deep-links the active view from the ?view param", async () => {
    server.use(
      http.get("*/api/sessions", () =>
        HttpResponse.json({
          sessions: [sessionRow({ preview: "deep-linked" })],
          nextCursor: null,
        }),
      ),
    );
    renderActivity("/?view=sessions");

    expect(await screen.findByRole("link", { name: /deep-linked/i })).toBeDefined();
  });
});
