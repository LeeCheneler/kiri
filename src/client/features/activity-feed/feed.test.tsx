import { afterEach, describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FakeIntersectionObserver } from "../../../../tests/setup/fake-intersection-observer.ts";
import type { ActivityEntry, RunListEntry, SessionListEntry } from "../../api.ts";
import { Feed, type FeedState } from "./feed.tsx";

afterEach(() => {
  FakeIntersectionObserver.reset();
});

// A fixed clock three minutes after the default `startedAt` so day markers and
// relative times render deterministically.
const NOW = new Date("2026-05-09T12:03:00.000Z");

const baseRun: RunListEntry = {
  id: "r1",
  workflowName: "deploy",
  status: "ok",
  startedAt: "2026-05-09T09:00:00.000Z",
  finishedAt: "2026-05-09T09:00:01.000Z",
  error: null,
  summary: null,
  definitionSnapshot: { name: "deploy", steps: [] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
};

const baseSession: SessionListEntry = {
  id: "s1",
  status: "idle",
  model: "anthropic:claude",
  imageModel: null,
  persona: null,
  pinned: false,
  startedAt: "2026-05-09T08:00:00.000Z",
  finishedAt: null,
  error: null,
  preview: "Summarise the readme",
  articles: [],
};

const runEntry = (over: Partial<RunListEntry> = {}): ActivityEntry => ({
  kind: "run",
  run: { ...baseRun, ...over },
});

const sessionEntry = (over: Partial<SessionListEntry> = {}): ActivityEntry => ({
  kind: "session",
  session: { ...baseSession, ...over },
});

const feedState = (over: Partial<FeedState> = {}): FeedState => ({
  isPending: false,
  isError: false,
  error: null,
  entries: [],
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => {},
  ...over,
});

const renderFeed = (state: FeedState, noun = "activity") =>
  render(
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <Feed state={state} noun={noun} now={NOW} />
    </Router>,
  );

describe("<Feed>", () => {
  it("shows a loading message while pending", () => {
    renderFeed(feedState({ isPending: true }), "runs");
    expect(screen.getByText(/loading runs/i)).toBeDefined();
  });

  it("surfaces an error via an alert", () => {
    renderFeed(feedState({ isError: true, error: new Error("boom") }), "sessions");
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load sessions: boom/i);
  });

  it("shows the empty state when there are no entries", () => {
    renderFeed(feedState({ entries: [] }));
    expect(screen.getByText(/no activity yet/i)).toBeDefined();
  });

  it("renders runs and sessions segmented by day marker", () => {
    renderFeed(
      feedState({
        entries: [
          runEntry({ id: "r1", workflowName: "deploy", startedAt: "2026-05-09T09:00:00.000Z" }),
          sessionEntry({ id: "s1", startedAt: "2026-05-09T08:00:00.000Z" }),
          runEntry({ id: "r2", workflowName: "build", startedAt: "2026-05-08T09:00:00.000Z" }),
        ],
      }),
    );
    expect(screen.getByText("Today")).toBeDefined();
    expect(screen.getByText("Yesterday")).toBeDefined();
    expect(screen.getByRole("link", { name: "deploy" }).getAttribute("href")).toBe(
      "/workflows/deploy",
    );
    expect(screen.getByRole("link", { name: /summarise the readme/i }).getAttribute("href")).toBe(
      "/sessions/s1",
    );
    expect(screen.getByRole("link", { name: "build" })).toBeDefined();
  });

  it("fetches the next page when the sentinel intersects", () => {
    let calls = 0;
    renderFeed(
      feedState({
        entries: [runEntry()],
        hasNextPage: true,
        fetchNextPage: () => {
          calls++;
        },
      }),
    );
    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected the sentinel to register an observer");
    act(() => observer.triggerIntersect());
    expect(calls).toBe(1);
  });

  it("ignores a sentinel callback that is not intersecting", () => {
    let calls = 0;
    renderFeed(
      feedState({
        entries: [runEntry()],
        hasNextPage: true,
        fetchNextPage: () => {
          calls++;
        },
      }),
    );
    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected the sentinel to register an observer");
    act(() => observer.triggerIntersect(false));
    expect(calls).toBe(0);
  });

  it("does not fetch while a page is already loading", () => {
    let calls = 0;
    renderFeed(
      feedState({
        entries: [runEntry()],
        hasNextPage: true,
        isFetchingNextPage: true,
        fetchNextPage: () => {
          calls++;
        },
      }),
    );
    const observer = FakeIntersectionObserver.latest();
    if (!observer) throw new Error("expected the sentinel to register an observer");
    act(() => observer.triggerIntersect());
    expect(calls).toBe(0);
  });

  it("marks the end of the feed when there is no next page", () => {
    renderFeed(feedState({ entries: [runEntry()], hasNextPage: false }));
    expect(screen.getByText(/end of feed/i)).toBeDefined();
  });
});
