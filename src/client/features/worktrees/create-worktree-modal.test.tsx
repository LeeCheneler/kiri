import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CreateWorktreeResult, RepoOverview } from "../../api.ts";
import { CreateWorktreeModal } from "./create-worktree-modal.tsx";

const repo = (overrides: Partial<RepoOverview> = {}): RepoOverview => ({
  name: "kiri",
  root: "/projects/kiri",
  gitCommonDir: "/projects/kiri/.git",
  defaultBranch: "main",
  worktrees: [],
  ...overrides,
});

const created = (overrides: Partial<CreateWorktreeResult> = {}): CreateWorktreeResult => ({
  status: "ok",
  path: "/projects/kiri-swift-otter",
  branch: "feat/thing",
  branchSource: "new",
  baseRef: "origin/main",
  prepare: null,
  ...overrides,
});

const noop = () => {};

type CreateBody = { repo: string; branch: string; name?: string; baseRef?: string };

const createMock = () => mock(async (_body: CreateBody) => created());

const renderModal = (
  onCreate: (body: CreateBody) => Promise<CreateWorktreeResult>,
  repos: RepoOverview[] = [repo()],
  onClose: () => void = noop,
) => render(<CreateWorktreeModal repos={repos} onCreate={onCreate} onClose={onClose} />);

const nameField = () => screen.getByRole("textbox", { name: /worktree name/i });
const branchField = () => screen.getByRole("textbox", { name: /branch/i });
const createButton = () => screen.getByRole("button", { name: "create" });

describe("<CreateWorktreeModal>", () => {
  it("pre-fills the worktree name with a suggestion the user can overwrite", async () => {
    const user = userEvent.setup();
    renderModal(async () => created());

    const field = nameField() as HTMLInputElement;
    expect(field.value).toMatch(/^[a-z]+-[a-z]+$/);

    await user.clear(field);
    await user.type(field, "review-pass");
    expect((nameField() as HTMLInputElement).value).toBe("review-pass");
  });

  it("hints the selected repo's default branch as the base ref", () => {
    renderModal(
      async () => created(),
      [repo(), repo({ name: "site", gitCommonDir: "/projects/site/.git", defaultBranch: "trunk" })],
    );
    expect(screen.getByPlaceholderText("main")).toBeDefined();
  });

  it("falls back to a description when the repo has no discoverable default branch", () => {
    renderModal(async () => created(), [repo({ defaultBranch: null })]);
    expect(screen.getByPlaceholderText(/the repo's default branch/i)).toBeDefined();
  });

  it("defaults the branch to the worktree name and tracks it until edited", async () => {
    const user = userEvent.setup();
    renderModal(async () => created());

    const suggested = (nameField() as HTMLInputElement).value;
    expect((branchField() as HTMLInputElement).value).toBe(suggested);

    await user.clear(nameField());
    await user.type(nameField(), "review-pass");
    expect((branchField() as HTMLInputElement).value).toBe("review-pass");

    await user.clear(branchField());
    await user.type(branchField(), "feat/thing");
    await user.type(nameField(), "-two");
    expect((branchField() as HTMLInputElement).value).toBe("feat/thing");
  });

  it("holds create when the name is cleared", async () => {
    const user = userEvent.setup();
    renderModal(async () => created());

    expect((createButton() as HTMLButtonElement).disabled).toBe(false);
    await user.clear(nameField());
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("holds create when the branch is cleared on its own", async () => {
    const user = userEvent.setup();
    renderModal(async () => created());

    await user.clear(branchField());
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the repo, branch, name, and base ref, omitting an empty base ref", async () => {
    const user = userEvent.setup();
    const onCreate = createMock();
    renderModal(onCreate);

    await user.clear(nameField());
    await user.type(nameField(), "review-pass");
    await user.clear(branchField());
    await user.type(branchField(), "feat/thing");
    await user.click(createButton());

    expect(onCreate.mock.calls[0]).toEqual([
      { repo: "kiri", branch: "feat/thing", name: "review-pass", baseRef: undefined },
    ]);
  });

  it("sends the chosen repo and base ref", async () => {
    const user = userEvent.setup();
    const onCreate = createMock();
    renderModal(onCreate, [
      repo(),
      repo({ name: "site", gitCommonDir: "/projects/site/.git", defaultBranch: "trunk" }),
    ]);

    await user.selectOptions(screen.getByRole("combobox", { name: /repo/i }), "site");
    await user.type(screen.getByRole("textbox", { name: /base ref/i }), "trunk");
    await user.click(createButton());

    expect(onCreate.mock.calls[0][0]).toMatchObject({ repo: "site", baseRef: "trunk" });
  });

  it("offers no opt-out of the repo's configured setup", () => {
    renderModal(async () => created());
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("reports where the worktree landed and how its branch resolved", async () => {
    const user = userEvent.setup();
    renderModal(async () => created({ branchSource: "remote", baseRef: null }));

    await user.click(createButton());

    expect(await screen.findByText(/created the worktree/i)).toBeDefined();
    expect(screen.getByText(/tracked the branch from origin/i)).toBeDefined();
    expect(screen.getByText("/projects/kiri-swift-otter")).toBeDefined();
  });

  it("shows the setup report, including a failed step's output", async () => {
    const user = userEvent.setup();
    renderModal(async () =>
      created({
        status: "failed",
        prepare: {
          status: "failed",
          steps: [
            {
              name: "postCreate: mise trust",
              status: "failed",
              error: "exited with code 3",
              stderr: "command not found",
            },
          ],
        },
      }),
    );

    await user.click(createButton());

    expect(await screen.findByText(/but its setup failed/i)).toBeDefined();
    expect(screen.getByText("command not found")).toBeDefined();
  });

  it("keeps the form and states the reason when nothing was created", async () => {
    const user = userEvent.setup();
    renderModal(async () => {
      throw new Error("'/projects/kiri-swift-otter' already exists");
    });

    await user.click(createButton());

    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
    expect(createButton()).toBeDefined();
  });

  it("falls back to a plain message when the failure carries none", async () => {
    const user = userEvent.setup();
    renderModal(async () => {
      throw "nope";
    });

    await user.click(createButton());

    expect((await screen.findByRole("alert")).textContent).toContain("wasn't created");
  });

  it("says nothing about the branch when the result reports no source", async () => {
    const user = userEvent.setup();
    renderModal(async () => created({ branchSource: null, baseRef: null }));

    await user.click(createButton());

    expect(await screen.findByText(/created the worktree/i)).toBeDefined();
    expect(screen.queryByText(/created the branch/i)).toBeNull();
  });

  it("closes from cancel and from done", async () => {
    const user = userEvent.setup();
    const onClose = mock(noop);
    renderModal(async () => created(), [repo()], onClose);

    await user.click(screen.getByRole("button", { name: "cancel" }));
    expect(onClose.mock.calls).toHaveLength(1);

    await user.click(createButton());
    await user.click(await screen.findByRole("button", { name: "done" }));
    expect(onClose.mock.calls).toHaveLength(2);
  });
});
