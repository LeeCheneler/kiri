import { afterEach, describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FakeIntersectionObserver } from "../../../../tests/setup/fake-intersection-observer.ts";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { Runs } from "./runs.tsx";

afterEach(() => {
  FakeIntersectionObserver.reset();
});

// A feed row carries only the fields RunRow reads; `summary` doubles as a
// per-page handle so a freshly-loaded page is observable by its copy.
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

const renderRuns = (workflowName = "deploy") =>
  render(
    <Router hook={memoryLocation({ path: `/workflows/${workflowName}` }).hook}>
      <QueryClientProvider client={createQueryClient()}>
        <Runs workflowName={workflowName} />
      </QueryClientProvider>
    </Router>,
  );

describe("<Runs>", () => {
  it("shows a loading message until the first page resolves", () => {
    server.use(http.get("*/api/runs", () => new Promise(() => {})));
    renderRuns();
    expect(screen.getByText(/loading runs/i)).toBeDefined();
  });

  it("surfaces a fetch failure via an alert", async () => {
    server.use(http.get("*/api/runs", () => new HttpResponse("boom", { status: 500 })));
    renderRuns();
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load runs/i);
  });

  it("shows the empty state when the workflow has no runs", async () => {
    server.use(http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null })));
    renderRuns();
    expect(await screen.findByText(/no runs yet/i)).toBeDefined();
  });

  it("renders the runs scoped to its workflow and marks the end of the feed", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get("*/api/runs", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("workflow"));
        return HttpResponse.json({ runs: [feedRun({ id: "r1" })], nextCursor: null });
      }),
    );
    renderRuns();

    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("/runs/r1");
    expect(seen).toEqual(["deploy"]);
    expect(screen.getByText(/end of feed/i)).toBeDefined();
  });

  it("loads the next page when the sentinel scrolls into view", async () => {
    server.use(
      http.get("*/api/runs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor === null) {
          return HttpResponse.json({
            runs: [feedRun({ id: "r1", summary: "page one" })],
            nextCursor: "r1",
          });
        }
        return HttpResponse.json({
          runs: [feedRun({ id: "r2", summary: "page two" })],
          nextCursor: null,
        });
      }),
    );
    renderRuns();
    await screen.findByText("page one");
    expect(screen.queryByText("page two")).toBeNull();

    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected the sentinel to register an observer");
    act(() => observer.triggerIntersect());

    await screen.findByText("page two");
    expect(screen.getByText(/end of feed/i)).toBeDefined();
  });

  it("shows a loading indicator while the next page is in flight", async () => {
    server.use(
      http.get("*/api/runs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor === null) {
          return HttpResponse.json({
            runs: [feedRun({ id: "r1", summary: "page one" })],
            nextCursor: "r1",
          });
        }
        return new Promise(() => {});
      }),
    );
    renderRuns();
    await screen.findByText("page one");

    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected the sentinel to register an observer");
    act(() => observer.triggerIntersect());

    expect(await screen.findByText(/loading more/i)).toBeDefined();
  });

  it("ignores a sentinel callback that is not intersecting", async () => {
    let nextPageFetches = 0;
    server.use(
      http.get("*/api/runs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor === null) {
          return HttpResponse.json({
            runs: [feedRun({ id: "r1", summary: "page one" })],
            nextCursor: "r1",
          });
        }
        nextPageFetches++;
        return HttpResponse.json({ runs: [], nextCursor: null });
      }),
    );
    renderRuns();
    await screen.findByText("page one");

    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected the sentinel to register an observer");
    act(() => observer.triggerIntersect(false));
    await flushAsync();

    expect(nextPageFetches).toBe(0);
  });

  it("does not advance while a page is already loading", async () => {
    let nextPageFetches = 0;
    server.use(
      http.get("*/api/runs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor === null) {
          return HttpResponse.json({
            runs: [feedRun({ id: "r1", summary: "page one" })],
            nextCursor: "r1",
          });
        }
        nextPageFetches++;
        return new Promise(() => {});
      }),
    );
    renderRuns();
    await screen.findByText("page one");

    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected the sentinel to register an observer");
    act(() => observer.triggerIntersect());
    await screen.findByText(/loading more/i);
    act(() => observer.triggerIntersect());
    await flushAsync();

    expect(nextPageFetches).toBe(1);
  });
});
