import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { RunListEntry } from "../api.ts";
import { ActivityFeed } from "./activity-feed.tsx";

const NOW = new Date("2026-05-09T12:00:00.000Z");

const stubRun = (overrides: Partial<RunListEntry> = {}): RunListEntry => ({
  id: "run-1",
  workflowName: "kiri-self-review",
  status: "ok",
  startedAt: new Date(NOW.getTime() - 3 * 60 * 1000).toISOString(),
  finishedAt: new Date(NOW.getTime() - 3 * 60 * 1000 + 12_000).toISOString(),
  error: null,
  summary: null,
  definitionSnapshot: { name: "kiri-self-review", steps: [] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
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

  // The row's header — workflow name plus the status/trigger line
  // beneath it — is wrapped in a `<Link>`. Status / hover state live
  // on the wrapping `<div data-status>`; query both via the link's
  // accessible name (which contains the workflow name).
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

  it("renders the workflow name, status, relative start time and duration", () => {
    renderFeed([
      stubRun({
        workflowName: "pr-review",
        status: "failed",
        startedAt: new Date(NOW.getTime() - 3 * 60 * 1000).toISOString(),
        finishedAt: new Date(NOW.getTime() - 3 * 60 * 1000 + 12_000).toISOString(),
      }),
    ]);

    expect(screen.getByText(/pr-review/i)).toBeDefined();
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
    // The summary sits below the row's header link, so markdown links
    // inside it are real, separately-targetable anchors with their own
    // href — they're not nested inside the row link.
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

  it("scopes the row link to the workflow headline — byline and summary sit outside it", () => {
    renderFeed([
      stubRun({
        workflowName: "pr-review",
        summary: "this is the summary body content.",
      }),
    ]);
    const rowLink = screen.getByRole("link", { name: /pr-review/i });
    const text = rowLink.textContent ?? "";
    expect(text).not.toContain("this is the summary body");
  });

  describe("article list", () => {
    const article = (
      overrides: Partial<{
        name: string;
        title: string;
        heading: string | null;
        createdAt: string;
      }> = {},
    ) => ({
      name: "digest",
      title: "PR Review Digest",
      heading: null as string | null,
      createdAt: "2026-05-09T11:59:00.000Z",
      ...overrides,
    });

    it("renders no article links when the run has no articles", () => {
      renderFeed([stubRun({ id: "abc", articles: [] })]);
      // The row's primary link is the only one — no extra article links.
      expect(screen.getAllByRole("link")).toHaveLength(1);
    });

    it("renders one entry per article", () => {
      renderFeed([
        stubRun({
          id: "abc",
          articles: [
            article({ name: "digest", title: "PR Review Digest" }),
            article({ name: "release-notes", title: "Release Notes" }),
          ],
        }),
      ]);
      const digestEntry = screen.getByRole("link", { name: /PR Review Digest/ });
      expect(digestEntry.getAttribute("href")).toBe("/runs/abc/published/digest");
      const notesEntry = screen.getByRole("link", { name: /Release Notes/ });
      expect(notesEntry.getAttribute("href")).toBe("/runs/abc/published/release-notes");
    });

    it("renders the article title as the link label (no name leakage)", () => {
      renderFeed([
        stubRun({
          id: "abc",
          articles: [article({ name: "weekly-digest", title: "Weekly Digest" })],
        }),
      ]);
      // The label is the resolved title — the URL-safe slug stays in the
      // href, not in the visible text.
      const entry = screen.getByRole("link", { name: /Weekly Digest/ });
      expect(entry.getAttribute("href")).toBe("/runs/abc/published/weekly-digest");
      expect(screen.queryByText("weekly-digest")).toBeNull();
    });

    it("renders the article's first markdown heading as a sub-byline when present", () => {
      renderFeed([
        stubRun({
          id: "abc",
          articles: [
            article({ name: "digest", title: "PR Review Digest", heading: "Three PRs merged" }),
            article({ name: "notes", title: "Release Notes", heading: null }),
          ],
        }),
      ]);
      const withHeading = screen.getByRole("link", { name: /PR Review Digest/ });
      expect(withHeading.textContent).toContain("Three PRs merged");
      const withoutHeading = screen.getByRole("link", { name: /Release Notes/ });
      expect(withoutHeading.textContent).not.toContain("Three PRs merged");
    });

    it("keeps all entries visible regardless of count (no collapse)", () => {
      renderFeed([
        stubRun({
          id: "abc",
          articles: [
            article({ name: "a", title: "Alpha" }),
            article({ name: "b", title: "Bravo" }),
            article({ name: "c", title: "Charlie" }),
            article({ name: "d", title: "Delta" }),
          ],
        }),
      ]);
      expect(screen.getByRole("link", { name: /Alpha/ }).getAttribute("href")).toBe(
        "/runs/abc/published/a",
      );
      expect(screen.getByRole("link", { name: /Delta/ }).getAttribute("href")).toBe(
        "/runs/abc/published/d",
      );
      // No collapsed "N articles" link.
      expect(screen.queryByRole("link", { name: /\d+ articles/i })).toBeNull();
    });

    it("clicking an entry targets the article, not the run page", () => {
      // Entries sit below the row's header link as independent anchors.
      // Assert by hrefs: the entry's href is the article route, distinct
      // from the row link's run route.
      renderFeed([
        stubRun({
          id: "abc",
          workflowName: "pr-review",
          articles: [article()],
        }),
      ]);
      const rowLink = screen.getByRole("link", { name: /pr-review/i });
      expect(rowLink.getAttribute("href")).toBe("/runs/abc");
      const entry = screen.getByRole("link", { name: /PR Review Digest/ });
      expect(entry.getAttribute("href")).toBe("/runs/abc/published/digest");
    });
  });

  describe("recommendation count", () => {
    it("omits the marker when the count is zero", () => {
      renderFeed([stubRun({ recommendationsCount: 0 })]);
      expect(screen.queryByText(/recommendation/i)).toBeNull();
    });

    it("renders 'N recommendations' in the byline when the count is greater than one", () => {
      renderFeed([stubRun({ recommendationsCount: 10 })]);
      expect(screen.getByText(/^10 recommendations$/)).toBeDefined();
    });

    it("renders the singular '1 recommendation' when the count is exactly one", () => {
      renderFeed([stubRun({ recommendationsCount: 1 })]);
      expect(screen.getByText(/^1 recommendation$/)).toBeDefined();
    });

    it("renders the marker as plain text — not a link or button", () => {
      renderFeed([stubRun({ id: "abc", workflowName: "pr-review", recommendationsCount: 2 })]);
      // The only link on the row is the headline; the marker carries no
      // own navigation target.
      const links = screen.getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]?.getAttribute("href")).toBe("/runs/abc");
      expect(screen.queryByRole("button", { name: /recommendation/i })).toBeNull();
    });
  });

  describe("workflow variant", () => {
    const renderWorkflowFeed = (runs: RunListEntry[]) => {
      const { hook } = memoryLocation({ path: "/" });
      return render(
        <Router hook={hook}>
          <ActivityFeed runs={runs} now={NOW} variant="workflow" />
        </Router>,
      );
    };

    it("titles each row with the run's first input value", () => {
      renderWorkflowFeed([
        stubRun({
          id: "abc",
          workflowName: "dev-patch",
          inputs: { repo: "autoid-verify-service" },
        }),
      ]);
      const link = screen.getByRole("link", { name: /autoid-verify-service/i });
      expect(link.getAttribute("href")).toBe("/runs/abc");
      // The workflow name does not lead the headline when an input does.
      expect(screen.queryByRole("link", { name: /dev-patch/i })).toBeNull();
    });

    it("falls back to the workflow name when the run has no inputs", () => {
      renderWorkflowFeed([stubRun({ workflowName: "dev-patch", inputs: null })]);
      expect(screen.getByRole("link", { name: /dev-patch/i })).toBeDefined();
    });

    it("shows the run's short git SHA in the kicker when present", () => {
      renderWorkflowFeed([stubRun({ gitSha: "576a5ae0c1d2e3f4" })]);
      expect(screen.getByText("576a5ae")).toBeDefined();
    });

    it("omits the SHA segment when the run has no git SHA", () => {
      const { container } = renderWorkflowFeed([stubRun({ gitSha: null })]);
      expect(container.querySelector("code")).toBeNull();
    });

    it("renders only the summary's first line, dropping the rest", () => {
      renderWorkflowFeed([
        stubRun({ summary: "patched 2 advisories at PR #79.\nfull detail on the run page." }),
      ]);
      expect(screen.getByText(/patched 2 advisories at PR #79\./)).toBeDefined();
      expect(screen.queryByText(/full detail on the run page/)).toBeNull();
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
