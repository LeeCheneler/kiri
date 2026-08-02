import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import type { PullResult, RepoOverview, WorktreeStatus } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { WorktreesSection } from "./worktrees-section.tsx";

const worktree = (overrides: Partial<WorktreeStatus> = {}): WorktreeStatus => ({
  path: "/projects/kiri",
  branch: "main",
  detached: false,
  head: "abc1234",
  dirty: false,
  ahead: 0,
  behind: 0,
  upstreamGone: false,
  locked: false,
  prunable: false,
  primary: false,
  ...overrides,
});

const repo = (worktrees: WorktreeStatus[]): RepoOverview => ({
  name: "kiri",
  root: "/projects/kiri",
  gitCommonDir: "/projects/kiri/.git",
  defaultBranch: "main",
  lastFetchedAt: null,
  worktrees,
});

const renderSection = (value: RepoOverview, failures: PullResult[] = []) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <WorktreesSection repo={value} failures={failures} />
    </QueryClientProvider>,
  );

// A repo whose linked worktrees cover the state vocabulary between them.
const stocked = repo([
  worktree({ primary: true }),
  worktree({
    path: "/projects/kiri-feat-search",
    branch: "feat/search",
    dirty: true,
    ahead: 2,
    behind: 1,
  }),
  worktree({ path: "/projects/kiri-detached", branch: null, detached: true }),
  worktree({ path: "/projects/kiri-stale", branch: "feat/stale", upstreamGone: true }),
  worktree({ path: "/projects/kiri-old", branch: "feat/old", locked: true, prunable: true }),
]);

describe("<WorktreesSection>", () => {
  it("lists each linked worktree with the state that says what to do with it", () => {
    renderSection(stocked);

    expect(screen.getByText("kiri-feat-search")).toBeDefined();
    expect(screen.getByText("feat/search")).toBeDefined();
    expect(screen.getByText("dirty")).toBeDefined();
    expect(screen.getByText("ahead 2")).toBeDefined();
    expect(screen.getByText("behind 1")).toBeDefined();
    expect(screen.getByText("detached")).toBeDefined();
    expect(screen.getByText("upstream gone")).toBeDefined();
    expect(screen.getByText("locked")).toBeDefined();
    expect(screen.getByText("prunable")).toBeDefined();
    expect(screen.getAllByText("clean").length).toBeGreaterThan(0);
  });

  // A repo with one linked worktree carrying the scan's conflict answer.
  const withConflicts = (conflicts?: string[]) =>
    renderSection(
      repo([
        worktree({ primary: true }),
        worktree({ path: "/projects/kiri-feat-search", branch: "feat/search", conflicts }),
      ]),
    );

  it("flags a worktree whose branch no longer merges into the default branch", () => {
    withConflicts(["src/api.ts", "docs/notes.md"]);

    const card = screen
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText("kiri-feat-search") !== null) as HTMLElement;
    expect(within(card).getByText("conflicts main")).toBeDefined();
    expect(within(card).getByText(/src\/api\.ts, docs\/notes\.md/)).toBeDefined();
  });

  it("says the answer is only as fresh as the last update", () => {
    withConflicts(["src/api.ts"]);

    expect(screen.getByText(/as of the last update/i)).toBeDefined();
  });

  it("names the first few conflicting files and counts the rest", () => {
    withConflicts(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);

    expect(screen.getByText(/a\.ts, b\.ts, c\.ts and 2 more/)).toBeDefined();
  });

  it("says nothing at all about a branch that still merges cleanly", () => {
    withConflicts([]);

    expect(screen.queryByText("conflicts main")).toBeNull();
    expect(screen.queryByText(/as of the last update/i)).toBeNull();
  });

  it("says nothing about a worktree the scan had no answer for", () => {
    withConflicts(undefined);

    expect(screen.queryByText("conflicts main")).toBeNull();
  });

  it("gives each linked worktree a way into its own changes", () => {
    renderSection(
      repo([
        worktree({ primary: true }),
        worktree({ path: "/projects/kiri-feat-search", branch: "feat/search", dirty: true }),
      ]),
    );
    expect(screen.getByRole("link", { name: /review changes/i }).getAttribute("href")).toBe(
      "/git/kiri/changes/kiri-feat-search?view=uncommitted",
    );
  });

  it("reports an update refusal inside the card of the checkout it concerns", () => {
    renderSection(
      repo([
        worktree({ primary: true }),
        worktree({ path: "/projects/kiri-feat-search", branch: "feat/search", behind: 2 }),
      ]),
      [
        {
          path: "/projects/kiri-feat-search",
          branch: "feat/search",
          status: "refused",
          commits: 0,
          reason: "the working tree has uncommitted changes",
        },
      ],
    );

    const card = screen
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText("kiri-feat-search") !== null);
    expect(within(card as HTMLElement).getByText(/uncommitted changes/i)).toBeDefined();
    // The checkouts the update brought current say nothing at all.
    expect(screen.getAllByText(/uncommitted changes/i)).toHaveLength(1);
  });

  it("lists the primary checkout, marked as such and with no removal offered", () => {
    renderSection(stocked);
    expect(screen.getByText("primary")).toBeDefined();
    // One remove action per linked worktree, and none for the primary.
    expect(screen.getAllByRole("button", { name: "remove" })).toHaveLength(4);
  });

  it("gives the primary checkout the same way into its changes as any other", () => {
    renderSection(repo([worktree({ primary: true, dirty: true })]));
    expect(screen.getByRole("link", { name: /review changes/i }).getAttribute("href")).toBe(
      "/git/kiri/changes/kiri?view=uncommitted",
    );
  });

  it("reports an update refusal on the primary checkout too", () => {
    renderSection(repo([worktree({ primary: true, behind: 2 })]), [
      {
        path: "/projects/kiri",
        branch: "main",
        status: "failed",
        commits: 0,
        error: "could not resolve host",
      },
    ]);
    expect(screen.getByText(/could not resolve host/i)).toBeDefined();
  });

  it("names a detached checkout rather than leaving it blank", () => {
    renderSection(repo([worktree({ primary: true, branch: null, detached: true })]));
    expect(screen.getByText("detached")).toBeDefined();
  });

  it("labels a branchless, attached worktree rather than leaving it blank", () => {
    renderSection(repo([worktree({ path: "/projects/kiri-odd", branch: null })]));
    expect(screen.getByText("no branch")).toBeDefined();
  });

  it("invites a first worktree when the repo is just its own checkout", () => {
    renderSection(repo([worktree({ primary: true })]));
    expect(screen.getByText(/just its own checkout/i)).toBeDefined();
  });

  it("creates a worktree in the repo whose page it is on", async () => {
    let created: unknown;
    server.use(
      http.post("*/api/git/create", async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({
          status: "ok",
          path: "/projects/kiri-swift-otter",
          branch: "swift-otter",
          branchSource: "new",
          baseRef: "origin/main",
          prepare: null,
        });
      }),
    );
    renderSection(repo([worktree({ primary: true })]));

    await userEvent.click(screen.getByRole("button", { name: /new worktree/i }));
    await userEvent.clear(screen.getByRole("textbox", { name: /worktree name/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /worktree name/i }), "swift-otter");
    await userEvent.click(screen.getByRole("button", { name: "create" }));

    expect(await screen.findByText("/projects/kiri-swift-otter")).toBeDefined();
    expect(created).toMatchObject({ repo: "kiri", branch: "swift-otter", name: "swift-otter" });

    await userEvent.click(screen.getByRole("button", { name: "done" }));
    expect(screen.queryByRole("button", { name: "done" })).toBeNull();
  });

  it("removes a worktree from its row", async () => {
    let removed: unknown;
    server.use(
      http.post("*/api/git/remove", async ({ request }) => {
        removed = await request.json();
        return HttpResponse.json({
          status: "ok",
          path: "/projects/kiri-stale",
          branch: "feat/stale",
          deletedBranchSha: "9149b26",
          pull: "skipped",
          warnings: [],
        });
      }),
    );
    renderSection(repo([worktree({ path: "/projects/kiri-stale", branch: "feat/stale" })]));

    await userEvent.click(screen.getByRole("button", { name: "remove" }));
    await userEvent.click(screen.getAllByRole("button", { name: "remove" }).slice(-1)[0]);

    expect(await screen.findByText(/removed the worktree/i)).toBeDefined();
    expect(removed).toEqual({ path: "/projects/kiri-stale" });

    await userEvent.click(screen.getByRole("button", { name: "done" }));
    expect(screen.queryByRole("button", { name: "done" })).toBeNull();
  });

  it("offers no prune action when git holds nothing stale", () => {
    renderSection(repo([worktree({ path: "/projects/kiri-feat", branch: "feat/thing" })]));
    expect(screen.queryByRole("button", { name: /review and prune/i })).toBeNull();
  });

  it("announces stale entries and confirms what a prune would clear", async () => {
    let pruned: unknown;
    server.use(
      http.post("*/api/git/prune", async ({ request }) => {
        pruned = await request.json();
        return HttpResponse.json({ repo: "kiri", pruned: ["/projects/kiri-old"] });
      }),
    );
    renderSection(repo([worktree({ path: "/projects/kiri-old", prunable: true })]));

    expect(screen.getByText(/1 entry to clear/i)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /review and prune/i }));

    // The confirmation names the stale worktree, and nothing has run yet.
    expect(await screen.findByText("/projects/kiri-old")).toBeDefined();
    expect(pruned).toBeUndefined();

    await userEvent.click(screen.getByRole("button", { name: "prune" }));
    expect(await screen.findByText(/cleared 1 entry/i)).toBeDefined();
    expect(pruned).toEqual({ repo: "kiri" });

    await userEvent.click(screen.getByRole("button", { name: "done" }));
    expect(screen.queryByRole("button", { name: "done" })).toBeNull();
  });

  it("counts several stale entries in the plural", () => {
    renderSection(
      repo([
        worktree({ path: "/projects/kiri-old", prunable: true }),
        worktree({ path: "/projects/kiri-older", prunable: true }),
      ]),
    );
    expect(screen.getByText(/2 entries to clear/i)).toBeDefined();
  });
});
