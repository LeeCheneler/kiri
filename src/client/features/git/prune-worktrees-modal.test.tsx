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
  worktrees,
});

const noop = () => {};

const pruneMock = (pruned: string[]) =>
  mock(async (repoName: string): Promise<PruneWorktreesResult> => ({ repo: repoName, pruned }));

const renderModal = (
  repos: RepoOverview[],
  onPrune: (repo: string) => Promise<PruneWorktreesResult> = pruneMock([]),
  onClose: () => void = noop,
) => render(<PruneWorktreesModal repos={repos} onPrune={onPrune} onClose={onClose} />);

describe("<PruneWorktreesModal>", () => {
  it("lists exactly what would be cleared, grouped by repo", () => {
    renderModal([
      repo("kiri", [worktree("/projects/kiri-old", true), worktree("/projects/kiri", false)]),
      repo("settled", [worktree("/projects/settled", false)]),
      repo("site", [worktree("/projects/site-gone", true)]),
    ]);

    expect(screen.getByText("/projects/kiri-old")).toBeDefined();
    expect(screen.getByText("/projects/site-gone")).toBeDefined();
    // A repo with nothing stale is left out of the confirmation entirely.
    expect(screen.queryByText("settled")).toBeNull();
  });

  it("prunes every repo holding stale entries and reports the total", async () => {
    const user = userEvent.setup();
    const onPrune = mock(
      async (repoName: string): Promise<PruneWorktreesResult> => ({
        repo: repoName,
        pruned: [`/projects/${repoName}-gone`],
      }),
    );
    renderModal(
      [
        repo("kiri", [worktree("/projects/kiri-gone", true)]),
        repo("site", [worktree("/projects/site-gone", true)]),
      ],
      onPrune,
    );

    await user.click(screen.getByRole("button", { name: "prune" }));

    expect(await screen.findByText(/cleared 2 entries/i)).toBeDefined();
    expect(onPrune.mock.calls).toEqual([["kiri"], ["site"]]);
  });

  it("counts a single cleared entry in the singular", async () => {
    const user = userEvent.setup();
    renderModal(
      [repo("kiri", [worktree("/projects/kiri-gone", true)])],
      pruneMock(["/projects/kiri-gone"]),
    );

    await user.click(screen.getByRole("button", { name: "prune" }));
    expect(await screen.findByText(/cleared 1 entry/i)).toBeDefined();
  });

  it("keeps the confirmation and states the reason when a prune fails", async () => {
    const user = userEvent.setup();
    renderModal([repo("kiri", [worktree("/projects/kiri-gone", true)])], async () => {
      throw new Error("not a git repository");
    });

    await user.click(screen.getByRole("button", { name: "prune" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not a git repository");
    expect(screen.getByRole("button", { name: "prune" })).toBeDefined();
  });

  it("falls back to a plain message when the failure carries none", async () => {
    const user = userEvent.setup();
    renderModal([repo("kiri", [worktree("/projects/kiri-gone", true)])], async () => {
      throw "nope";
    });

    await user.click(screen.getByRole("button", { name: "prune" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was pruned");
  });

  it("closes from cancel and from done", async () => {
    const user = userEvent.setup();
    const onClose = mock(noop);
    renderModal([repo("kiri", [worktree("/projects/kiri-gone", true)])], pruneMock([]), onClose);

    await user.click(screen.getByRole("button", { name: "cancel" }));
    expect(onClose.mock.calls).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "prune" }));
    await user.click(await screen.findByRole("button", { name: "done" }));
    expect(onClose.mock.calls).toHaveLength(2);
  });
});
