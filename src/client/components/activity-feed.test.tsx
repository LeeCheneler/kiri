import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { RunListEntry } from "../api.ts";
import { ActivityFeed } from "./activity-feed.tsx";

afterEach(() => cleanup());

const NOW = new Date("2026-05-09T12:00:00.000Z");

const stubRun = (overrides: Partial<RunListEntry> = {}): RunListEntry => ({
  id: "run-1",
  workflowName: "kiri-self-review",
  status: "ok",
  trigger: "manual",
  startedAt: new Date(NOW.getTime() - 3 * 60 * 1000).toISOString(),
  finishedAt: new Date(NOW.getTime() - 3 * 60 * 1000 + 12_000).toISOString(),
  error: null,
  summary: null,
  definitionSnapshot: { name: "kiri-self-review", steps: [] },
  isInterrupted: false,
  ...overrides,
});

const renderFeed = (runs: RunListEntry[]) => {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <ActivityFeed runs={runs} now={NOW} />
    </Router>,
  );
};

describe("<ActivityFeed>", () => {
  it("renders an empty-state sentence when there are no runs", () => {
    renderFeed([]);
    expect(screen.getByText(/no runs yet/i)).toBeDefined();
  });

  it("links each row to its run detail page", () => {
    renderFeed([stubRun({ id: "abc", workflowName: "alpha" })]);
    const link = screen.getByRole("link", { name: /alpha/i });
    expect(link.getAttribute("href")).toBe("/runs/abc");
  });

  it("tags running rows with data-status='running'", () => {
    renderFeed([stubRun({ id: "r", status: "running", finishedAt: null })]);
    expect(screen.getByRole("link").getAttribute("data-status")).toBe("running");
  });

  it("tags ok rows with data-status='ok'", () => {
    renderFeed([stubRun({ status: "ok" })]);
    expect(screen.getByRole("link").getAttribute("data-status")).toBe("ok");
  });

  it("tags failed rows with data-status='failed'", () => {
    renderFeed([stubRun({ status: "failed" })]);
    expect(screen.getByRole("link").getAttribute("data-status")).toBe("failed");
  });

  it("tags cancelled rows with data-status='cancelled'", () => {
    renderFeed([stubRun({ status: "cancelled" })]);
    expect(screen.getByRole("link").getAttribute("data-status")).toBe("cancelled");
  });

  it("preserves the underlying status when the workflow has been deleted", () => {
    renderFeed([stubRun({ status: "ok", isInterrupted: true })]);
    expect(screen.getByRole("link").getAttribute("data-status")).toBe("ok");
  });

  it("renders a deleted marker for runs whose workflow is gone", () => {
    renderFeed([stubRun({ isInterrupted: true })]);
    expect(screen.getByText(/deleted/i)).toBeDefined();
  });

  it("does not render the marker for runs whose workflow still exists", () => {
    renderFeed([stubRun({ isInterrupted: false })]);
    expect(screen.queryByText(/deleted/i)).toBeNull();
  });

  it("renders the workflow name, trigger, status, relative start time and duration", () => {
    renderFeed([
      stubRun({
        workflowName: "pr-review",
        status: "failed",
        trigger: "scheduled",
        startedAt: new Date(NOW.getTime() - 3 * 60 * 1000).toISOString(),
        finishedAt: new Date(NOW.getTime() - 3 * 60 * 1000 + 12_000).toISOString(),
      }),
    ]);

    expect(screen.getByText(/pr-review/i)).toBeDefined();
    expect(screen.getByText(/scheduled/i)).toBeDefined();
    expect(screen.getByText(/failed/i)).toBeDefined();
    expect(screen.getByText(/3 minutes ago/i)).toBeDefined();
    expect(screen.getByText(/12s/i)).toBeDefined();
  });

  it("renders the summary text when present", () => {
    renderFeed([stubRun({ summary: "reviewed the changes and flagged a regression in auth.ts." })]);
    expect(
      screen.getByText(/reviewed the changes and flagged a regression in auth\.ts\./i),
    ).toBeDefined();
  });

  it("does not render a summary block when summary is null", () => {
    const { container } = renderFeed([stubRun({ summary: null })]);
    expect(container.querySelector("p.line-clamp-2")).toBeNull();
  });

  it("omits the duration text for runs that haven't finished", () => {
    renderFeed([
      stubRun({
        status: "running",
        startedAt: new Date(NOW.getTime() - 30 * 1000).toISOString(),
        finishedAt: null,
      }),
    ]);

    expect(screen.getByText(/30 seconds ago/i)).toBeDefined();
    expect(screen.queryByText(/^\d+s$/)).toBeNull();
  });
});
