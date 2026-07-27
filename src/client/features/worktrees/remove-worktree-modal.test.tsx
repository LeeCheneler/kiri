import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RemoveWorktreeResult, WorktreeStatus } from "../../api.ts";
import { RemoveWorktreeModal } from "./remove-worktree-modal.tsx";

const worktree = (overrides: Partial<WorktreeStatus> = {}): WorktreeStatus => ({
  path: "/projects/kiri-swift-otter",
  branch: "feat/thing",
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

const removed = (overrides: Partial<RemoveWorktreeResult> = {}): RemoveWorktreeResult => ({
  status: "ok",
  path: "/projects/kiri-swift-otter",
  branch: "feat/thing",
  deletedBranchSha: "9149b26",
  pull: "ok",
  warnings: [],
  ...overrides,
});

const noop = () => {};

const renderModal = (
  onRemove: (path: string, force?: boolean) => Promise<RemoveWorktreeResult>,
  status: WorktreeStatus = worktree(),
  onClose: () => void = noop,
) => render(<RemoveWorktreeModal worktree={status} onRemove={onRemove} onClose={onClose} />);

const removeButton = () => screen.getByRole("button", { name: "remove" });

describe("<RemoveWorktreeModal>", () => {
  it("spells out what goes with the worktree", () => {
    renderModal(async () => removed());
    expect(screen.getByText("/projects/kiri-swift-otter")).toBeDefined();
    expect(screen.getByText(/the branch feat\/thing is deleted/i)).toBeDefined();
  });

  it("says there is no branch to delete for a detached worktree", () => {
    renderModal(async () => removed(), worktree({ branch: null, detached: true }));
    expect(screen.getByText(/no branch to delete/i)).toBeDefined();
  });

  it("removes a clean worktree without asking for anything else", async () => {
    const user = userEvent.setup();
    const onRemove = mock(async (_path: string, _force?: boolean) => removed());
    renderModal(onRemove);

    expect(screen.queryByRole("checkbox")).toBeNull();
    await user.click(removeButton());
    expect(onRemove.mock.calls).toEqual([["/projects/kiri-swift-otter", undefined]]);
  });

  it("holds a dirty worktree behind an explicit opt-in that names the loss", async () => {
    const user = userEvent.setup();
    const onRemove = mock(async (_path: string, _force?: boolean) => removed());
    renderModal(onRemove, worktree({ dirty: true, ahead: 2 }));

    expect(screen.getByText(/uncommitted changes and 2 commits it hasn't pushed/i)).toBeDefined();
    expect((removeButton() as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /remove it anyway/i }));
    expect((removeButton() as HTMLButtonElement).disabled).toBe(false);
    await user.click(removeButton());
    expect(onRemove.mock.calls).toEqual([["/projects/kiri-swift-otter", true]]);
  });

  it("counts a single unpushed commit in the singular", () => {
    renderModal(async () => removed(), worktree({ ahead: 1 }));
    expect(screen.getByText(/1 commit it hasn't pushed/i)).toBeDefined();
  });

  it("surfaces the deleted branch's sha and how to restore it", async () => {
    const user = userEvent.setup();
    renderModal(async () => removed());

    await user.click(removeButton());
    expect(await screen.findByText(/removed the worktree/i)).toBeDefined();
    expect(screen.getByText(/feat\/thing was at 9149b26/i)).toBeDefined();
    expect(screen.getByText(/git branch feat\/thing 9149b26/i)).toBeDefined();
    expect(screen.getByText(/fast-forwarded the primary checkout/i)).toBeDefined();
  });

  it("lists the follow-up the removal couldn't finish", async () => {
    const user = userEvent.setup();
    renderModal(async () =>
      removed({
        deletedBranchSha: null,
        pull: "skipped",
        warnings: ["no origin remote — skipped the pull"],
      }),
    );

    await user.click(removeButton());
    expect(await screen.findByText(/no origin remote/i)).toBeDefined();
    expect(screen.queryByText(/git branch/i)).toBeNull();
  });

  it("keeps the confirmation and states the reason when the removal is refused", async () => {
    const user = userEvent.setup();
    renderModal(async () => {
      throw new Error("has uncommitted changes");
    });

    await user.click(removeButton());
    expect((await screen.findByRole("alert")).textContent).toContain("uncommitted changes");
    expect(removeButton()).toBeDefined();
  });

  it("falls back to a plain message when the failure carries none", async () => {
    const user = userEvent.setup();
    renderModal(async () => {
      throw "nope";
    });

    await user.click(removeButton());
    expect((await screen.findByRole("alert")).textContent).toContain("wasn't removed");
  });

  it("closes from cancel and from done", async () => {
    const user = userEvent.setup();
    const onClose = mock(noop);
    renderModal(async () => removed(), worktree(), onClose);

    await user.click(screen.getByRole("button", { name: "cancel" }));
    expect(onClose.mock.calls).toHaveLength(1);

    await user.click(removeButton());
    await user.click(await screen.findByRole("button", { name: "done" }));
    expect(onClose.mock.calls).toHaveLength(2);
  });
});
