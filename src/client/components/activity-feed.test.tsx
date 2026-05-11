import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
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
  gitSha: null,
  gitDirty: null,
  isInterrupted: false,
  artefacts: [],
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

  // The row wraps a real `<Link>` on the workflow name plus a `::before`
  // overlay so clicks anywhere on the row navigate to the run page.
  // Status / hover state live on the wrapping `<div data-status>` rather
  // than on the link itself — query both via the link's accessible name
  // (the workflow name).
  const rowOf = (workflowName: RegExp | string) =>
    screen.getByRole("link", { name: workflowName }).closest("[data-status]");

  it("links each row to its run detail page", () => {
    renderFeed([stubRun({ id: "abc", workflowName: "alpha" })]);
    const link = screen.getByRole("link", { name: /alpha/i });
    expect(link.getAttribute("href")).toBe("/runs/abc");
  });

  it("tags running rows with data-status='running'", () => {
    renderFeed([stubRun({ id: "r", status: "running", finishedAt: null })]);
    expect(rowOf(/kiri-self-review/i)?.getAttribute("data-status")).toBe("running");
  });

  it("tags ok rows with data-status='ok'", () => {
    renderFeed([stubRun({ status: "ok" })]);
    expect(rowOf(/kiri-self-review/i)?.getAttribute("data-status")).toBe("ok");
  });

  it("tags failed rows with data-status='failed'", () => {
    renderFeed([stubRun({ status: "failed" })]);
    expect(rowOf(/kiri-self-review/i)?.getAttribute("data-status")).toBe("failed");
  });

  it("tags cancelled rows with data-status='cancelled'", () => {
    renderFeed([stubRun({ status: "cancelled" })]);
    expect(rowOf(/kiri-self-review/i)?.getAttribute("data-status")).toBe("cancelled");
  });

  it("preserves the underlying status when the workflow has been deleted", () => {
    renderFeed([stubRun({ status: "ok", isInterrupted: true })]);
    expect(rowOf(/kiri-self-review/i)?.getAttribute("data-status")).toBe("ok");
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

  it("renders a prose summary as a paragraph when present", () => {
    renderFeed([stubRun({ summary: "reviewed the changes and flagged a regression in auth.ts." })]);
    expect(
      screen.getByText(/reviewed the changes and flagged a regression in auth\.ts\./i),
    ).toBeDefined();
  });

  it("renders a list-shaped summary as a bullet list, not truncated", () => {
    const summary = [
      "- **#42** payments: refund flow tweaks",
      "- **#43** auth: rotate session secret",
      "- **#44** infra: bump terraform provider",
    ].join("\n");
    const { container } = renderFeed([stubRun({ summary })]);
    // Bullet list renders through <Markdown> inside the row's summary block,
    // not as a clamped paragraph. Scope to the summary container so the
    // run-row <li> doesn't sneak into the listitem query.
    const summaryEl = container.querySelector(".kiri-feed-summary");
    const bullets = Array.from(summaryEl?.querySelectorAll("li") ?? []).map(
      (li) => li.textContent ?? "",
    );
    expect(bullets).toEqual([
      "#42 payments: refund flow tweaks",
      "#43 auth: rotate session secret",
      "#44 infra: bump terraform provider",
    ]);
  });

  it("does not render a summary block when summary is null", () => {
    const { container } = renderFeed([stubRun({ summary: null })]);
    expect(container.querySelector(".kiri-feed-summary")).toBeNull();
  });

  it("renders markdown links inside the summary as distinct, navigable anchors", () => {
    // The row uses a stacked-link pattern (real Link on the workflow name +
    // ::before overlay over the row). Markdown links inside the summary
    // must remain real, separately-targetable anchors with their own href.
    renderFeed([
      stubRun({
        workflowName: "pr-review",
        summary: "see [the PR](https://example.com/pr/42) for details.",
      }),
    ]);
    const rowLink = screen.getByRole("link", { name: /pr-review/i });
    expect(rowLink.getAttribute("href")).toBe("/runs/run-1");
    const summaryLink = screen.getByRole("link", { name: /the PR/i });
    expect(summaryLink.getAttribute("href")).toBe("https://example.com/pr/42");
  });

  describe("artefact chips", () => {
    const artefact = (
      overrides: Partial<{ name: string; title: string; createdAt: string }> = {},
    ) => ({
      name: "digest",
      title: "PR Review Digest",
      createdAt: "2026-05-09T11:59:00.000Z",
      ...overrides,
    });

    it("renders no chips when the run has no artefacts", () => {
      renderFeed([stubRun({ id: "abc", artefacts: [] })]);
      // The row's primary link is the only one — no extra artefact links.
      expect(screen.getAllByRole("link")).toHaveLength(1);
    });

    it("renders one chip per artefact when there are 1–3", () => {
      renderFeed([
        stubRun({
          id: "abc",
          artefacts: [
            artefact({ name: "digest", title: "PR Review Digest" }),
            artefact({ name: "release-notes", title: "Release Notes" }),
          ],
        }),
      ]);
      const digestChip = screen.getByRole("link", { name: /^PR Review Digest$/ });
      expect(digestChip.getAttribute("href")).toBe("/runs/abc/published/digest");
      const notesChip = screen.getByRole("link", { name: /^Release Notes$/ });
      expect(notesChip.getAttribute("href")).toBe("/runs/abc/published/release-notes");
    });

    it("renders the artefact title as the chip label (no name leakage)", () => {
      renderFeed([
        stubRun({
          id: "abc",
          artefacts: [artefact({ name: "weekly-digest", title: "Weekly Digest" })],
        }),
      ]);
      // The label is the resolved title — the URL-safe slug stays in the
      // href, not in the visible text.
      const chip = screen.getByRole("link", { name: /^Weekly Digest$/ });
      expect(chip.getAttribute("href")).toBe("/runs/abc/published/weekly-digest");
      expect(screen.queryByText("weekly-digest")).toBeNull();
    });

    it("collapses to a single chip at 4 or more artefacts", () => {
      renderFeed([
        stubRun({
          id: "abc",
          artefacts: [
            artefact({ name: "a", title: "A" }),
            artefact({ name: "b", title: "B" }),
            artefact({ name: "c", title: "C" }),
            artefact({ name: "d", title: "D" }),
          ],
        }),
      ]);
      // Individual chip labels are gone — replaced by a single counted chip.
      expect(screen.queryByRole("link", { name: /^A$/ })).toBeNull();
      const collapsed = screen.getByRole("link", { name: /4 artefacts/i });
      expect(collapsed.getAttribute("href")).toBe("/runs/abc");
    });

    it("clicking a chip targets the artefact, not the run page", () => {
      // With the stacked-link pattern, chips paint above the row's
      // ::before overlay, so a click on the chip never reaches the row
      // link. Assert by hrefs: the chip's href is the artefact route,
      // distinct from the row link's run route.
      renderFeed([
        stubRun({
          id: "abc",
          workflowName: "pr-review",
          artefacts: [artefact()],
        }),
      ]);
      const rowLink = screen.getByRole("link", { name: /^pr-review$/i });
      expect(rowLink.getAttribute("href")).toBe("/runs/abc");
      const chip = screen.getByRole("link", { name: /^PR Review Digest$/ });
      expect(chip.getAttribute("href")).toBe("/runs/abc/published/digest");
    });
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

  it("attaches the sentinel ref to the placeholder below the list", () => {
    const ref = createRef<HTMLDivElement>();
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ActivityFeed runs={[stubRun()]} now={NOW} sentinelRef={ref} />
      </Router>,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it("renders a loading-more indicator while a follow-on page is in flight", () => {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ActivityFeed runs={[stubRun()]} now={NOW} isLoadingMore />
      </Router>,
    );
    expect(screen.getByText(/loading more/i)).toBeDefined();
  });

  it("renders an end-of-feed indicator instead of the sentinel when exhausted", () => {
    const ref = createRef<HTMLDivElement>();
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ActivityFeed runs={[stubRun()]} now={NOW} sentinelRef={ref} endReached />
      </Router>,
    );
    expect(screen.getByText(/end of feed/i)).toBeDefined();
    expect(ref.current).toBeNull();
  });
});
