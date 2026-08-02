import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { RepoList } from "./repo-list.tsx";

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

const repo = (name: string, worktrees: unknown[], overrides: Record<string, unknown> = {}) => ({
  name,
  root: `/projects/${name}`,
  gitCommonDir: `/projects/${name}/.git`,
  defaultBranch: "main",
  lastFetchedAt: null,
  worktrees,
  ...overrides,
});

const payload = (repos: unknown[], overrides: Record<string, unknown> = {}) => ({
  roots: ["/projects"],
  refreshing: false,
  scannedAt: new Date().toISOString(),
  repos,
  ...overrides,
});

// One repo carrying every kind of unfinished business: a clean primary, a dirty
// branch ahead and behind, one whose upstream is gone, and one git still holds a
// record for.
const busy = payload([
  repo("kiri", [
    worktree({ primary: true }),
    worktree({
      path: "/projects/kiri-feat-search",
      branch: "feat/search",
      dirty: true,
      ahead: 2,
      behind: 1,
    }),
    worktree({ path: "/projects/kiri-stale", branch: "feat/stale", upstreamGone: true }),
    worktree({ path: "/projects/kiri-old", branch: "feat/old", prunable: true }),
  ]),
]);

const renderList = () =>
  render(
    <Router hook={memoryLocation({ path: "/git" }).hook}>
      <QueryClientProvider client={createQueryClient()}>
        <RepoList />
      </QueryClientProvider>
    </Router>,
  );

const filterField = () => screen.getByPlaceholderText(/filter repos/i);

describe("<RepoList>", () => {
  it("shows a loading state while the overview is in flight", () => {
    server.use(http.get("*/api/git", () => new Promise<Response>(() => {})));
    renderList();
    expect(screen.getByText(/loading repos/i)).toBeDefined();
  });

  it("shows an error notice when the overview fails to load", async () => {
    server.use(http.get("*/api/git", () => new HttpResponse(null, { status: 500 })));
    renderList();
    expect(await screen.findByText(/couldn't load repos/i)).toBeDefined();
  });

  it("points at the config when no roots are configured", async () => {
    // The MSW default is the unconfigured model — no roots, no repos.
    renderList();
    expect(await screen.findByText(/none are listed, so there is nothing to scan/i)).toBeDefined();
  });

  it("lists the scanned roots when they hold no repos", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(payload([]))));
    renderList();
    expect(await screen.findByText(/no git repos were found/i)).toBeDefined();
    expect(screen.getByText("/projects")).toBeDefined();
  });

  it("links each repo through to its own page", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(busy)));
    renderList();
    expect((await screen.findByRole("link", { name: /kiri/i })).getAttribute("href")).toBe(
      "/git/kiri",
    );
  });

  it("escapes a repo name that isn't URL-safe in the link to its page", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(payload([repo("my repo", [worktree({ primary: true })])])),
      ),
    );
    renderList();
    expect((await screen.findByRole("link", { name: /my repo/i })).getAttribute("href")).toBe(
      "/git/my%20repo",
    );
  });

  it("summarises what each repo is carrying without opening it", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(busy)));
    renderList();

    expect(await screen.findByText("3 worktrees")).toBeDefined();
    expect(screen.getByText("1 dirty")).toBeDefined();
    expect(screen.getByText("ahead 2")).toBeDefined();
    expect(screen.getByText("behind 1")).toBeDefined();
    expect(screen.getByText("1 upstream gone")).toBeDefined();
    expect(screen.getByText("1 prunable")).toBeDefined();
    expect(screen.getByText("default branch main")).toBeDefined();
  });

  it("counts a lone linked worktree in the singular", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([
            repo("kiri", [worktree({ primary: true }), worktree({ path: "/projects/kiri-one" })]),
          ]),
        ),
      ),
    );
    renderList();
    expect(await screen.findByText("1 worktree")).toBeDefined();
  });

  it("says a repo carrying nothing is clean rather than leaving it bare", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([repo("site", [worktree({ path: "/projects/site", primary: true })])]),
        ),
      ),
    );
    renderList();
    expect(await screen.findByText("clean")).toBeDefined();
  });

  it("says so when a repo has no discoverable default branch", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([repo("bare", [worktree({ path: "/projects/bare" })], { defaultBranch: null })]),
        ),
      ),
    );
    renderList();
    expect(await screen.findByText("no default branch")).toBeDefined();
  });

  it("leads with the repos wanting attention, then the ones being worked in", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([
            repo("alpha", [worktree({ path: "/projects/alpha", primary: true })]),
            repo("bravo", [
              worktree({ path: "/projects/bravo", primary: true }),
              worktree({ path: "/projects/bravo-feat", branch: "feat/thing" }),
            ]),
            repo("zulu", [worktree({ path: "/projects/zulu", primary: true, dirty: true })]),
          ]),
        ),
      ),
    );
    renderList();
    await screen.findByRole("link", { name: /zulu/i });

    // Order here is computed from the data, not fixed by the JSX: the dirty repo
    // leads, then the one with a worktree checked out, then the quiet one.
    const names = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(names).toEqual(["/git/zulu", "/git/bravo", "/git/alpha"]);
  });

  it("counts the worktrees whose branch no longer merges into the default branch", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([
            repo("kiri", [
              worktree({ primary: true }),
              worktree({ path: "/projects/kiri-one", conflicts: ["src/api.ts"] }),
              worktree({ path: "/projects/kiri-two", conflicts: [] }),
            ]),
          ]),
        ),
      ),
    );
    renderList();

    expect(await screen.findByText("1 conflicting")).toBeDefined();
  });

  it("hoists a repo holding a conflicting worktree to the front of the list", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([
            repo("alpha", [worktree({ path: "/projects/alpha", primary: true })]),
            repo("bravo", [
              worktree({ path: "/projects/bravo", primary: true }),
              worktree({ path: "/projects/bravo-feat", branch: "feat/thing" }),
            ]),
            repo("zulu", [
              worktree({ path: "/projects/zulu", primary: true }),
              worktree({ path: "/projects/zulu-feat", conflicts: ["src/api.ts"] }),
            ]),
          ]),
        ),
      ),
    );
    renderList();
    await screen.findByRole("link", { name: /zulu/i });

    const names = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(names).toEqual(["/git/zulu", "/git/bravo", "/git/alpha"]);
  });

  it("narrows the listing to the repos matching the filter", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([
            repo("kiri", [worktree({ primary: true })]),
            repo("site", [worktree({ path: "/projects/site", primary: true })]),
          ]),
        ),
      ),
    );
    renderList();
    await screen.findByRole("link", { name: /kiri/i });

    await userEvent.type(filterField(), "site");
    expect(screen.getByRole("link", { name: /site/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /kiri/i })).toBeNull();
  });

  it("matches a repo on a worktree's branch and path, not just its own name", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(busy)));
    renderList();
    await screen.findByRole("link", { name: /kiri/i });

    await userEvent.type(filterField(), "feat/stale");
    expect(screen.getByRole("link", { name: /kiri/i })).toBeDefined();

    await userEvent.clear(filterField());
    await userEvent.type(filterField(), "projects/kiri-old");
    expect(screen.getByRole("link", { name: /kiri/i })).toBeDefined();
  });

  it("says so when the filter matches nothing", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(busy)));
    renderList();
    await screen.findByRole("link", { name: /kiri/i });

    await userEvent.type(filterField(), "nothing-here");
    expect(screen.getByText(/no repos match/i)).toBeDefined();
  });

  it("offers no filter while there are no repos to filter", async () => {
    renderList();
    await screen.findByText(/none are listed, so there is nothing to scan/i);
    expect(screen.queryByPlaceholderText(/filter repos/i)).toBeNull();
  });

  it("reloads the listing once an update settles — nothing else renews it", async () => {
    server.use(
      http.get("*/api/git", () => HttpResponse.json(busy)),
      http.post("*/api/git/update-all", () => HttpResponse.json({ results: [] })),
    );
    renderList();
    await screen.findByRole("link", { name: /kiri/i });

    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(payload([repo("site", [worktree({ path: "/projects/site" })])])),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Update all" }));
    expect(await screen.findByRole("link", { name: /site/i })).toBeDefined();
  });

  describe("update all", () => {
    const two = payload([
      repo("kiri", [worktree({ primary: true })]),
      repo("site", [worktree({ path: "/projects/site", primary: true })]),
    ]);

    const answers = (results: unknown[]) => {
      server.use(
        http.get("*/api/git", () => HttpResponse.json(two)),
        http.post("*/api/git/update-all", () => HttpResponse.json({ results })),
      );
    };

    const clickUpdateAll = async () => {
      renderList();
      await userEvent.click(await screen.findByRole("button", { name: "Update all" }));
    };

    const landed = (name: string) => ({
      repo: name,
      fetch: { repo: name, status: "updated", updates: ["main -> origin/main"] },
      checkouts: [
        { path: `/projects/${name}`, branch: "main", status: "updated" as const, commits: 1 },
      ],
    });

    it("offers no update while there are no repos to update", async () => {
      renderList();
      await screen.findByText(/none are listed, so there is nothing to scan/i);
      expect(screen.queryByRole("button", { name: "Update all" })).toBeNull();
    });

    it("reports nothing at all when every repo came current", async () => {
      answers([landed("kiri"), landed("site")]);
      await clickUpdateAll();

      await waitFor(() => expect(screen.queryByRole("button", { name: /updating/i })).toBeNull());
      expect(screen.queryByText("updated")).toBeNull();
      expect(screen.queryByText(/main -> origin\/main/)).toBeNull();
    });

    it("names a repo it could not reach, in that repo's own card", async () => {
      answers([
        landed("kiri"),
        {
          repo: "site",
          fetch: {
            repo: "site",
            status: "failed",
            updates: [],
            error: "could not resolve host",
          },
          checkouts: [],
        },
      ]);
      await clickUpdateAll();

      await screen.findByText(/could not resolve host/i);
      const card = screen
        .getAllByRole("listitem")
        .find((item) => within(item).queryByRole("link", { name: /site/i }) !== null);
      expect(within(card as HTMLElement).getByText(/could not resolve host/i)).toBeDefined();
    });

    it("names a checkout it could not bring current, under the repo holding it", async () => {
      answers([
        {
          repo: "kiri",
          fetch: { repo: "kiri", status: "updated", updates: ["main -> origin/main"] },
          checkouts: [
            {
              path: "/projects/kiri-feat-search",
              branch: "feat/search",
              status: "refused",
              commits: 0,
              reason: "'feat/search' has diverged from origin/feat/search",
            },
          ],
        },
        landed("site"),
      ]);
      await clickUpdateAll();

      expect(await screen.findByText(/has diverged/i)).toBeDefined();
      expect(screen.getByText("kiri-feat-search")).toBeDefined();
    });

    it("surfaces a request that never reached the server", async () => {
      server.use(
        http.get("*/api/git", () => HttpResponse.json(two)),
        http.post("*/api/git/update-all", () => new HttpResponse(null, { status: 500 })),
      );
      await clickUpdateAll();

      expect(await screen.findByText(/couldn't update/i)).toBeDefined();
    });
  });
});
