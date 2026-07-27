import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { WorktreesOverview } from "./worktrees-overview.tsx";

const renderOverview = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <WorktreesOverview />
    </QueryClientProvider>,
  );

const worktree = (overrides: Record<string, unknown>) => ({
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

// One repo covering every per-worktree branch: a clean primary, a dirty branch
// ahead and behind, a detached checkout, one whose upstream is gone, and one
// that is both locked and prunable.
const payload = {
  roots: ["/projects"],
  repos: [
    {
      name: "kiri",
      root: "/projects/kiri",
      gitCommonDir: "/projects/kiri/.git",
      worktrees: [
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
        worktree({
          path: "/projects/kiri-old",
          branch: "feat/old",
          locked: true,
          prunable: true,
        }),
      ],
    },
  ],
};

describe("<WorktreesOverview>", () => {
  it("shows a loading state while the overview is in flight", () => {
    server.use(http.get("*/api/worktrees", () => new Promise<Response>(() => {})));
    renderOverview();
    expect(screen.getByText(/loading worktrees/i)).toBeDefined();
  });

  it("shows an error notice when the overview fails to load", async () => {
    server.use(http.get("*/api/worktrees", () => new HttpResponse(null, { status: 500 })));
    renderOverview();
    expect(await screen.findByText(/couldn't load worktrees/i)).toBeDefined();
  });

  it("points at the config when no roots are configured", async () => {
    // The MSW default is the unconfigured model — no roots, no repos.
    renderOverview();
    expect(await screen.findByText(/none are listed, so there is nothing to scan/i)).toBeDefined();
  });

  it("lists the scanned roots when they hold no repos", async () => {
    server.use(
      http.get("*/api/worktrees", () => HttpResponse.json({ roots: ["/projects"], repos: [] })),
    );
    renderOverview();
    expect(await screen.findByText(/no git repos were found/i)).toBeDefined();
    expect(screen.getByText("/projects")).toBeDefined();
  });

  it("groups worktrees under their repo with each one's state", async () => {
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(payload)));
    renderOverview();

    // A repo holding work starts expanded, so its rows are readable without a click.
    const repo = await screen.findByRole("button", { name: /kiri/i });
    expect(repo.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("/projects/kiri")).toBeDefined();

    // The primary checkout is marked as such and reads clean; the others carry
    // the facts that distinguish them.
    expect(screen.getByText("primary")).toBeDefined();
    expect(screen.getAllByText("clean").length).toBeGreaterThan(0);
    expect(screen.getByText("kiri-feat-search")).toBeDefined();
    expect(screen.getByText("feat/search")).toBeDefined();
    expect(screen.getByText("ahead 2")).toBeDefined();
    expect(screen.getByText("behind 1")).toBeDefined();
    expect(screen.getByText("dirty")).toBeDefined();
    expect(screen.getByText("detached")).toBeDefined();
    expect(screen.getByText("upstream gone")).toBeDefined();
    expect(screen.getByText("locked")).toBeDefined();
    expect(screen.getByText("prunable")).toBeDefined();
  });

  it("summarises a collapsed repo and expands it to the worktree rows", async () => {
    const settled = {
      roots: ["/projects"],
      repos: [
        {
          name: "site",
          root: "/projects/site",
          gitCommonDir: "/projects/site/.git",
          worktrees: [worktree({ path: "/projects/site", primary: true })],
        },
      ],
    };
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(settled)));
    renderOverview();

    // Nothing wants a decision, so the repo collapses to its name and size.
    const repo = await screen.findByRole("button", { name: /site/i });
    expect(repo.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("1 worktree")).toBeDefined();
    expect(screen.queryByText("/projects/site")).toBeNull();

    await userEvent.click(repo);
    expect(repo.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("/projects/site")).toBeDefined();
  });

  it("counts what a repo is carrying in its summary", async () => {
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(payload)));
    renderOverview();

    expect(await screen.findByText("5 worktrees")).toBeDefined();
    expect(screen.getByText("1 dirty")).toBeDefined();
    expect(screen.getByText("1 upstream gone")).toBeDefined();
    expect(screen.getByText("1 prunable")).toBeDefined();
  });

  it("labels a branchless, attached worktree rather than leaving it blank", async () => {
    server.use(
      http.get("*/api/worktrees", () =>
        HttpResponse.json({
          roots: ["/projects"],
          repos: [
            {
              name: "bare",
              root: "/projects/bare",
              gitCommonDir: "/projects/bare/.git",
              worktrees: [
                worktree({ path: "/projects/bare", branch: null, dirty: true, primary: true }),
              ],
            },
          ],
        }),
      ),
    );
    renderOverview();
    expect(await screen.findByText("no branch")).toBeDefined();
  });

  it("re-runs discovery and reloads the listing on refresh", async () => {
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(payload)));
    server.use(http.post("*/api/worktrees/refresh", () => HttpResponse.json(payload)));
    renderOverview();
    await screen.findByRole("button", { name: /kiri/i });

    server.use(
      http.get("*/api/worktrees", () =>
        HttpResponse.json({
          roots: ["/projects"],
          repos: [
            {
              name: "site",
              root: "/projects/site",
              gitCommonDir: "/projects/site/.git",
              worktrees: [],
            },
          ],
        }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("button", { name: /site/i })).toBeDefined();
  });

  it("surfaces a failed refresh without dropping the listing", async () => {
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(payload)));
    server.use(
      http.post("*/api/worktrees/refresh", () =>
        HttpResponse.json({ error: "roots unreadable" }, { status: 500 }),
      ),
    );
    renderOverview();
    await screen.findByRole("button", { name: /kiri/i });

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/couldn't refresh worktrees/i)).toBeDefined();
    expect(screen.getByText("roots unreadable")).toBeDefined();
    expect(screen.getByRole("button", { name: /kiri/i })).toBeDefined();
  });
});
