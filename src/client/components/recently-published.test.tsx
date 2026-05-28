import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { RecentlyPublished } from "./recently-published.tsx";

const NOW = new Date("2026-05-21T12:00:00.000Z");

const article = (
  overrides: Partial<{
    runId: string;
    name: string;
    title: string;
    heading: string | null;
    workflowName: string;
    createdAt: string;
  }> = {},
) => ({
  runId: "run-1",
  name: "digest",
  title: "PR Review Digest",
  heading: null as string | null,
  workflowName: "pr-review",
  createdAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
  ...overrides,
});

const renderRail = (path = "/") => {
  const { hook } = memoryLocation({ path });
  const { factory, sources } = captureEventSources();
  const ui = render(
    <Router hook={hook}>
      <LiveEventsProvider factory={factory}>
        <RecentlyPublished now={NOW} />
      </LiveEventsProvider>
    </Router>,
  );
  return { ...ui, sources };
};

describe("<RecentlyPublished>", () => {
  it("renders nothing while the initial fetch is in flight", () => {
    server.use(http.get("*/api/articles/recent", () => new Promise(() => {})));
    renderRail();
    expect(screen.queryByRole("heading", { name: /recently published/i })).toBeNull();
  });

  it("shows an empty state when nothing has been published", async () => {
    server.use(http.get("*/api/articles/recent", () => HttpResponse.json([])));
    renderRail();
    expect(await screen.findByText(/no articles published yet/i)).toBeDefined();
    expect(screen.getByRole("heading", { name: /recently published/i })).toBeDefined();
  });

  it("lists articles with their title link, workflow name, and relative time", async () => {
    server.use(
      http.get("*/api/articles/recent", () =>
        HttpResponse.json([
          article(),
          article({
            runId: "run-2",
            name: "notes",
            title: "Release Notes",
            workflowName: "release",
            createdAt: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
          }),
        ]),
      ),
    );
    renderRail();

    const digest = await screen.findByRole("link", { name: /PR Review Digest/i });
    expect(digest.getAttribute("href")).toBe("/runs/run-1/published/digest");
    expect(screen.getByText(/pr-review · 5 minutes ago/)).toBeDefined();

    const notes = screen.getByRole("link", { name: /Release Notes/i });
    expect(notes.getAttribute("href")).toBe("/runs/run-2/published/notes");
    expect(screen.getByText(/release · 2 hours ago/)).toBeDefined();
  });

  it("renders the article's first markdown heading as a byline when present", async () => {
    server.use(
      http.get("*/api/articles/recent", () =>
        HttpResponse.json([
          article({ heading: "This Week in PRs" }),
          article({
            runId: "run-2",
            name: "notes",
            title: "Release Notes",
            heading: null,
          }),
        ]),
      ),
    );
    renderRail();

    const headingLink = await screen.findByRole("link", { name: /pr review digest/i });
    expect(headingLink.textContent).toContain("This Week in PRs");
    const noHeadingLink = screen.getByRole("link", { name: /release notes/i });
    expect(noHeadingLink.textContent).not.toContain("This Week in PRs");
  });

  it("refetches and surfaces a new article when a run finishes", async () => {
    server.use(http.get("*/api/articles/recent", () => HttpResponse.json([])));
    const { sources } = renderRail();
    await screen.findByText(/no articles published yet/i);

    server.use(
      http.get("*/api/articles/recent", () =>
        HttpResponse.json([article({ runId: "run-9", name: "fresh", title: "Fresh Digest" })]),
      ),
    );
    act(() => {
      sources[0]?.emit({ type: "run.finished", id: "run-9", status: "ok", workflowName: "wf" });
    });

    expect(await screen.findByRole("link", { name: /Fresh Digest/i })).toBeDefined();
  });

  it("refetches and drops articles when a run is deleted", async () => {
    server.use(http.get("*/api/articles/recent", () => HttpResponse.json([article()])));
    const { sources } = renderRail();
    await screen.findByRole("link", { name: /PR Review Digest/i });

    server.use(http.get("*/api/articles/recent", () => HttpResponse.json([])));
    act(() => {
      sources[0]?.emit({ type: "run.deleted", id: "run-1" });
    });

    expect(await screen.findByText(/no articles published yet/i)).toBeDefined();
    expect(screen.queryByRole("link", { name: /PR Review Digest/i })).toBeNull();
  });

  it("recovers on event-stream reconnect", async () => {
    server.use(http.get("*/api/articles/recent", () => HttpResponse.json([])));
    const { sources } = renderRail();
    await screen.findByText(/no articles published yet/i);

    server.use(http.get("*/api/articles/recent", () => HttpResponse.json([article()])));
    act(() => {
      // First open is the initial connect (silent); the second is a
      // reconnect and fires the recovery refetch.
      sources[0]?.triggerOpen();
      sources[0]?.triggerOpen();
    });

    expect(await screen.findByRole("link", { name: /PR Review Digest/i })).toBeDefined();
  });

  it("marks the row matching the current location with aria-current='page'", async () => {
    server.use(
      http.get("*/api/articles/recent", () =>
        HttpResponse.json([
          article(),
          article({ runId: "run-2", name: "notes", title: "Release Notes" }),
        ]),
      ),
    );
    renderRail("/runs/run-2/published/notes");

    const active = await screen.findByRole("link", { name: /release notes/i });
    expect(active.getAttribute("aria-current")).toBe("page");
    const inactive = screen.getByRole("link", { name: /pr review digest/i });
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });

  it("renders nothing when the fetch fails", async () => {
    server.use(http.get("*/api/articles/recent", () => new HttpResponse("boom", { status: 500 })));
    renderRail();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("heading", { name: /recently published/i })).toBeNull();
  });
});
