import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PruneWorktreesResult, RepoOverview, WorktreeStatus } from "../../api.ts";
import { PruneWorktreesModal } from "./prune-worktrees-modal.tsx";

const worktree = (path: string, prunable: boolean): WorktreeStatus => ({
  path,
  branch: "feat/thing",
  detached: false,
  head: "abc1234",
  dirty: false,
  ahead: 0,
  behind: 0,
  upstreamGone: false,
  locked: false,
  prunable,
  primary: false,
});

const repo = (name: string, worktrees: WorktreeStatus[]): RepoOverview => ({
  name,
  root: `/projects/${name}`,
  gitCommonDir: `/projects/${name}/.git`,
  defaultBranch: "main",
  lastFetchedAt: null,
  worktrees,
});

const noop = () => {};

const pruneMock = (pruned: string[]) =>
  mock(async (repoName: string): Promise<PruneWorktreesResult> => ({ repo: repoName, pruned }));

const renderModal = (
  target: RepoOverview,
  onPrune: (repo: string) => Promise<PruneWorktreesResult> = pruneMock([]),
  onClose: () => void = noop,
) => render(<PruneWorktreesModal repo={target} onPrune={onPrune} onClose={onClose} />);

describe("<PruneWorktreesModal>", () => {
  it("lists exactly what would be cleared, leaving out what is still on disk", () => {
    renderModal(
      repo("kiri", [worktree("/projects/kiri-old", true), worktree("/projects/kiri-live", false)]),
    );

    expect(screen.getByText("/projects/kiri-old")).toBeDefined();
    expect(screen.queryByText("/projects/kiri-live")).toBeNull();
  });

  it("prunes the repo it was opened for and reports what it cleared", async () => {
    const user = userEvent.setup();
    const onPrune = pruneMock(["/projects/kiri-gone", "/projects/kiri-older"]);
    renderModal(repo("kiri", [worktree("/projects/kiri-gone", true)]), onPrune);

    await user.click(screen.getByRole("button", { name: "prune" }));

    expect(await screen.findByText(/cleared 2 entries/i)).toBeDefined();
    expect(onPrune.mock.calls).toEqual([["kiri"]]);
  });

  it("counts a single cleared entry in the singular", async () => {
    const user = userEvent.setup();
    renderModal(
      repo("kiri", [worktree("/projects/kiri-gone", true)]),
      pruneMock(["/projects/kiri-gone"]),
    );

    await user.click(screen.getByRole("button", { name: "prune" }));
    expect(await screen.findByText(/cleared 1 entry/i)).toBeDefined();
  });

  it("keeps the confirmation and states the reason when a prune fails", async () => {
    const user = userEvent.setup();
    renderModal(repo("kiri", [worktree("/projects/kiri-gone", true)]), async () => {
      throw new Error("not a git repository");
    });

    await user.click(screen.getByRole("button", { name: "prune" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not a git repository");
    expect(screen.getByRole("button", { name: "prune" })).toBeDefined();
  });

  it("falls back to a plain message when the failure carries none", async () => {
    const user = userEvent.setup();
    renderModal(repo("kiri", [worktree("/projects/kiri-gone", true)]), async () => {
      throw "nope";
    });

    await user.click(screen.getByRole("button", { name: "prune" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was pruned");
  });

  it("closes from cancel and from done", async () => {
    const user = userEvent.setup();
    const onClose = mock(noop);
    renderModal(repo("kiri", [worktree("/projects/kiri-gone", true)]), pruneMock([]), onClose);

    await user.click(screen.getByRole("button", { name: "cancel" }));
    expect(onClose.mock.calls).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "prune" }));
    await user.click(await screen.findByRole("button", { name: "done" }));
    expect(onClose.mock.calls).toHaveLength(2);
  });
});
