import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import type { WorktreeStatus } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { CheckoutPull } from "./checkout-pull.tsx";

const worktree = (overrides: Partial<WorktreeStatus> = {}): WorktreeStatus => ({
  path: "/projects/kiri-feat-search",
  branch: "feat/search",
  detached: false,
  head: "abc1234",
  dirty: false,
  ahead: 0,
  behind: 2,
  upstreamGone: false,
  locked: false,
  prunable: false,
  primary: false,
  ...overrides,
});

const renderPull = (subject: WorktreeStatus) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CheckoutPull worktree={subject} />
    </QueryClientProvider>,
  );

const pullButton = () => screen.getByRole("button", { name: "Pull" });

const answers = (body: Record<string, unknown>) => {
  server.use(http.post("*/api/git/pull", () => HttpResponse.json(body)));
};

describe("<CheckoutPull>", () => {
  it("offers the pull on a checkout a fast-forward would land on", () => {
    renderPull(worktree());
    expect(pullButton()).toBeDefined();
  });

  it.each([
    ["level with its upstream", { behind: 0 }],
    ["diverged", { ahead: 3 }],
    ["dirty", { dirty: true }],
    ["detached", { detached: true, branch: null }],
    ["missing its upstream", { upstreamGone: true }],
    ["on no branch at all", { branch: null }],
  ] as const)("renders nothing at all for a checkout %s", (_name, overrides) => {
    const { container } = renderPull(worktree(overrides));
    expect(container.firstChild).toBeNull();
  });

  it("says nothing about a pull that worked", async () => {
    answers({ path: "/projects/kiri-feat-search", status: "updated", commits: 2, updates: [] });
    renderPull(worktree());

    await userEvent.click(pullButton());
    await waitFor(() => expect(pullButton().hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText("updated")).toBeNull();
    expect(screen.queryByText(/fast-forwarded/i)).toBeNull();
  });

  it("names the reason kiri refused rather than reporting a bare status", async () => {
    answers({
      path: "/projects/kiri-feat-search",
      status: "refused",
      commits: 0,
      reason: "the working tree has uncommitted changes",
    });
    renderPull(worktree());

    await userEvent.click(pullButton());
    expect(await screen.findByText(/uncommitted changes/i)).toBeDefined();
    expect(screen.getByText("refused")).toBeDefined();
  });

  it("carries git's own message when the pull failed", async () => {
    answers({
      path: "/projects/kiri-feat-search",
      status: "failed",
      commits: 0,
      error: "fatal: could not read from remote",
    });
    renderPull(worktree());

    await userEvent.click(pullButton());
    expect(await screen.findByText(/could not read from remote/i)).toBeDefined();
  });

  it("says nothing about a pull that found nothing to do", async () => {
    answers({ path: "/projects/kiri-feat-search", status: "up-to-date", commits: 0 });
    renderPull(worktree());

    await userEvent.click(pullButton());
    await waitFor(() => expect(pullButton().hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText("up to date")).toBeNull();
  });

  it("surfaces a request the server turned away", async () => {
    server.use(
      http.post("*/api/git/pull", () =>
        HttpResponse.json({ error: "that checkout has gone" }, { status: 404 }),
      ),
    );
    renderPull(worktree());

    await userEvent.click(pullButton());
    expect(await screen.findByText(/that checkout has gone/i)).toBeDefined();
  });
});
