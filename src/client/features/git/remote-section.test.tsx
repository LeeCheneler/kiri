import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import type { RepoOverview } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { RemoteSection } from "./remote-section.tsx";

const worktree = (overrides: Record<string, unknown> = {}) => ({
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

const repo = (worktrees: unknown[]): RepoOverview =>
  ({
    name: "kiri",
    root: "/projects/kiri",
    gitCommonDir: "/projects/kiri/.git",
    defaultBranch: "main",
    worktrees,
  }) as RepoOverview;

const renderSection = (subject: RepoOverview) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RemoteSection repo={subject} />
    </QueryClientProvider>,
  );

const behindPrimary = repo([worktree({ primary: true, behind: 2 })]);

describe("<RemoteSection>", () => {
  it("lists only the checkouts with commits waiting on their upstream", () => {
    renderSection(
      repo([
        worktree({ primary: true, behind: 2 }),
        worktree({ path: "/projects/kiri-level", branch: "feat/level" }),
      ]),
    );

    expect(screen.getByText("kiri")).toBeDefined();
    expect(screen.getByText("behind 2")).toBeDefined();
    expect(screen.queryByText("kiri-level")).toBeNull();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDefined();
  });

  it("says so when nothing is behind rather than showing an empty list", () => {
    renderSection(repo([worktree({ primary: true })]));
    expect(screen.getByText(/nothing is behind its upstream/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();
  });

  it("withholds the pull from a dirty checkout and says why", () => {
    renderSection(repo([worktree({ primary: true, behind: 2, dirty: true })]));

    expect(screen.getByText(/uncommitted changes/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();
  });

  it("withholds the pull from a diverged checkout and says why", () => {
    renderSection(repo([worktree({ primary: true, behind: 2, ahead: 1 })]));

    expect(screen.getByText(/diverged/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();
  });

  it("reports what a fetch moved", async () => {
    server.use(
      http.post("*/api/git/fetch", () =>
        HttpResponse.json({
          repo: "kiri",
          status: "updated",
          updates: ["From github.com/example/kiri", "   abc123..def456  main -> origin/main"],
        }),
      ),
    );
    renderSection(behindPrimary);

    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByText("updated")).toBeDefined();
    expect(screen.getByText(/main -> origin\/main/)).toBeDefined();
  });

  it("reports a refused fetch with its reason rather than as a failure", async () => {
    server.use(
      http.post("*/api/git/fetch", () =>
        HttpResponse.json({
          repo: "kiri",
          status: "refused",
          updates: [],
          reason: "the repo has no remote",
        }),
      ),
    );
    renderSection(behindPrimary);

    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByText("refused")).toBeDefined();
    expect(screen.getByText("the repo has no remote")).toBeDefined();
  });

  it("reports git's message when a fetch fails", async () => {
    server.use(
      http.post("*/api/git/fetch", () =>
        HttpResponse.json({
          repo: "kiri",
          status: "failed",
          updates: [],
          error: "could not read from remote repository",
        }),
      ),
    );
    renderSection(behindPrimary);

    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByText("failed")).toBeDefined();
    expect(screen.getByText(/could not read from remote/i)).toBeDefined();
  });

  it("shows a pending state while the fetch is in flight", async () => {
    server.use(http.post("*/api/git/fetch", () => new Promise<Response>(() => {})));
    renderSection(behindPrimary);

    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByRole("button", { name: /fetching/i })).toBeDefined();
  });

  it("surfaces a failed fetch request without disturbing the section", async () => {
    server.use(http.post("*/api/git/fetch", () => new HttpResponse(null, { status: 500 })));
    renderSection(behindPrimary);

    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByText(/couldn't reach the server/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDefined();
  });

  it("reports how far a pull moved the checkout", async () => {
    server.use(
      http.post("*/api/git/pull", () =>
        HttpResponse.json({
          path: "/projects/kiri",
          branch: "main",
          status: "updated",
          commits: 2,
        }),
      ),
    );
    renderSection(behindPrimary);

    await userEvent.click(screen.getByRole("button", { name: "Pull" }));

    expect(await screen.findByText(/fast-forwarded 2 commits/i)).toBeDefined();
  });

  it("reports a pull the server refused, with its reason", async () => {
    server.use(
      http.post("*/api/git/pull", () =>
        HttpResponse.json({
          path: "/projects/kiri",
          branch: "main",
          status: "refused",
          commits: 0,
          reason: "the working tree has uncommitted changes",
        }),
      ),
    );
    renderSection(behindPrimary);

    await userEvent.click(screen.getByRole("button", { name: "Pull" }));

    expect(await screen.findByText("refused")).toBeDefined();
    expect(screen.getByText(/uncommitted changes/i)).toBeDefined();
  });

  it("surfaces a failed pull request", async () => {
    server.use(http.post("*/api/git/pull", () => new HttpResponse(null, { status: 500 })));
    renderSection(behindPrimary);

    await userEvent.click(screen.getByRole("button", { name: "Pull" }));

    expect(await screen.findByText(/couldn't reach the server/i)).toBeDefined();
  });

  it("keeps an account of every checkout pulled, not just the last one", async () => {
    server.use(
      http.post("*/api/git/pull", async ({ request }) => {
        const { path } = (await request.json()) as { path: string };
        return HttpResponse.json({ path, branch: "main", status: "updated", commits: 1 });
      }),
    );
    renderSection(
      repo([
        worktree({ primary: true, behind: 2 }),
        worktree({ path: "/projects/kiri-feat", branch: "feat/thing", behind: 1 }),
      ]),
    );

    const [first, second] = screen.getAllByRole("button", { name: "Pull" });
    await userEvent.click(first);
    await screen.findByText(/fast-forwarded 1 commit/i);
    await userEvent.click(second);

    await waitFor(() => expect(screen.getAllByText(/fast-forwarded 1 commit/i)).toHaveLength(2));
    expect(screen.getByText("kiri-feat")).toBeDefined();
  });

  it("shows a pending state on the checkout being pulled", async () => {
    server.use(http.post("*/api/git/pull", () => new Promise<Response>(() => {})));
    renderSection(
      repo([
        worktree({ primary: true, behind: 2 }),
        worktree({ path: "/projects/kiri-feat", branch: "feat/thing", behind: 1 }),
      ]),
    );

    const [first] = screen.getAllByRole("button", { name: "Pull" });
    await userEvent.click(first);

    await waitFor(() => expect(screen.getByRole("button", { name: /pulling/i })).toBeDefined());
    expect(screen.getAllByRole("button", { name: "Pull" })).toHaveLength(1);
  });
});
