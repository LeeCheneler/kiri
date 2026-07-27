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
      defaultBranch: "main",
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
          defaultBranch: "main",
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
              defaultBranch: null,
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
              defaultBranch: "main",
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

  // A repo whose default branch differs from every checked-out branch, so the
  // summary's default-branch tag is unambiguous.
  const withDefaultBranch = (defaultBranch: string | null) => ({
    roots: ["/projects"],
    repos: [
      {
        name: "site",
        root: "/projects/site",
        gitCommonDir: "/projects/site/.git",
        defaultBranch,
        worktrees: [worktree({ path: "/projects/site", primary: true })],
      },
    ],
  });

  it("names the repo's default branch in its summary", async () => {
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(withDefaultBranch("trunk"))));
    renderOverview();
    expect(await screen.findByText("trunk")).toBeDefined();
  });

  it("omits the default branch when the repo has none", async () => {
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(withDefaultBranch(null))));
    renderOverview();
    await screen.findByRole("button", { name: /site/i });
    expect(screen.queryByText("trunk")).toBeNull();
  });

  it("offers no create action while there are no repos to create in", async () => {
    renderOverview();
    await screen.findByText(/none are listed, so there is nothing to scan/i);
    expect(screen.queryByRole("button", { name: /new worktree/i })).toBeNull();
  });

  it("creates a worktree and lets the reloaded listing show it", async () => {
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(payload)));
    let created: unknown;
    server.use(
      http.post("*/api/worktrees/create", async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({
          status: "ok",
          path: "/projects/kiri-swift-otter",
          branch: "feat/thing",
          branchSource: "new",
          baseRef: "origin/main",
          prepare: null,
        });
      }),
    );
    renderOverview();
    await screen.findByRole("button", { name: /kiri/i });

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
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(payload)));
    let removed: unknown;
    server.use(
      http.post("*/api/worktrees/remove", async ({ request }) => {
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
    renderOverview();
    await screen.findByRole("button", { name: /kiri/i });

    // The primary checkout is the repo itself, so only the linked worktrees
    // offer a removal.
    const removeButtons = screen.getAllByRole("button", { name: "remove" });
    expect(removeButtons).toHaveLength(4);

    await userEvent.click(removeButtons[2]);
    await userEvent.click(screen.getAllByRole("button", { name: "remove" }).slice(-1)[0]);

    expect(await screen.findByText(/removed the worktree/i)).toBeDefined();
    expect(removed).toEqual({ path: "/projects/kiri-stale" });

    await userEvent.click(screen.getByRole("button", { name: "done" }));
    expect(screen.queryByRole("button", { name: "done" })).toBeNull();
  });

  it("offers no prune action when git holds nothing stale", async () => {
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(withDefaultBranch("trunk"))));
    renderOverview();
    await screen.findByRole("button", { name: /site/i });
    expect(screen.queryByRole("button", { name: /review and prune/i })).toBeNull();
  });

  it("announces stale entries and confirms what a prune would clear", async () => {
    server.use(http.get("*/api/worktrees", () => HttpResponse.json(payload)));
    let pruned: unknown;
    server.use(
      http.post("*/api/worktrees/prune", async ({ request }) => {
        pruned = await request.json();
        return HttpResponse.json({ repo: "kiri", pruned: ["/projects/kiri-old"] });
      }),
    );
    renderOverview();
    expect(await screen.findByText(/1 stale entry to clear/i)).toBeDefined();

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
});
