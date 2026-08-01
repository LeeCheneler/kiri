import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { RepoDetail } from "./repo-detail.tsx";

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

const payload = (repos: unknown[]) => ({
  roots: ["/projects"],
  refreshing: false,
  scannedAt: new Date().toISOString(),
  repos,
});

const kiri = (overrides: Record<string, unknown> = {}) => ({
  name: "kiri",
  root: "/projects/kiri",
  gitCommonDir: "/projects/kiri/.git",
  defaultBranch: "main",
  lastFetchedAt: null,
  worktrees: [worktree({ primary: true, dirty: true, ahead: 3 })],
  ...overrides,
});

const renderDetail = (name = "kiri") =>
  render(
    <Router hook={memoryLocation({ path: `/git/${name}` }).hook}>
      <QueryClientProvider client={createQueryClient()}>
        <RepoDetail name={name} />
      </QueryClientProvider>
    </Router>,
  );

describe("<RepoDetail>", () => {
  it("shows a loading state while the overview is in flight", () => {
    server.use(http.get("*/api/git", () => new Promise<Response>(() => {})));
    renderDetail();
    expect(screen.getByText(/loading repo/i)).toBeDefined();
  });

  it("shows an error notice when the overview fails to load", async () => {
    server.use(http.get("*/api/git", () => new HttpResponse(null, { status: 500 })));
    renderDetail();
    expect(await screen.findByText(/couldn't load repo/i)).toBeDefined();
  });

  it("renders a not-found state for a repo the roots don't hold", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(payload([kiri()]))));
    renderDetail("gone");
    expect(await screen.findByText(/repo not found/i)).toBeDefined();
    expect(screen.getByText("gone")).toBeDefined();
  });

  it("heads the page with where the repo is and what its primary checkout carries", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(payload([kiri()]))));
    renderDetail();

    expect(await screen.findByText("/projects/kiri")).toBeDefined();
    expect(screen.getByText("dirty")).toBeDefined();
    expect(screen.getByText("ahead 3")).toBeDefined();
    // The default branch and the branch the primary is sitting on are both said.
    expect(screen.getAllByText("main")).toHaveLength(2);
  });

  it("says a repo has no default branch rather than leaving the fact blank", async () => {
    server.use(
      http.get("*/api/git", () => HttpResponse.json(payload([kiri({ defaultBranch: null })]))),
    );
    renderDetail();
    expect(await screen.findByText("none")).toBeDefined();
  });

  it("names a detached primary checkout rather than leaving it blank", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([
            kiri({ worktrees: [worktree({ primary: true, branch: null, detached: true })] }),
          ]),
        ),
      ),
    );
    renderDetail();
    expect(await screen.findByText("detached")).toBeDefined();
  });

  it("still renders the repo when the scan found no primary checkout for it", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([kiri({ worktrees: [worktree({ path: "/projects/kiri-feat" })] })]),
        ),
      ),
    );
    renderDetail();
    expect(await screen.findByRole("region", { name: /worktrees/i })).toBeDefined();
    expect(screen.queryByText(/primary checkout/i)).toBeNull();
  });

  it("carries the repo's worktrees as a section of its page", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(
          payload([
            kiri({
              worktrees: [
                worktree({ primary: true }),
                worktree({ path: "/projects/kiri-feat-search", branch: "feat/search" }),
              ],
            }),
          ]),
        ),
      ),
    );
    renderDetail();
    const section = await screen.findByRole("region", { name: /worktrees/i });
    expect(section.textContent).toContain("kiri-feat-search");
  });

  it("gives the primary checkout a way into its own changes", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(payload([kiri()]))));
    renderDetail();
    const link = await screen.findByRole("link", { name: /review changes/i });
    expect(link.getAttribute("href")).toBe("/git/kiri/changes/kiri?view=uncommitted");
  });

  it("offers the repo's fetch whatever state its checkouts are in", async () => {
    // A checkout can only be known to be behind once a fetch has happened, so
    // the action is never gated on anything looking out of date.
    server.use(http.get("*/api/git", () => HttpResponse.json(payload([kiri()]))));
    renderDetail();
    expect(await screen.findByRole("button", { name: "Fetch" })).toBeDefined();
  });

  it("offers the pull on the primary checkout when a fast-forward would land", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(payload([kiri({ worktrees: [worktree({ primary: true, behind: 2 })] })])),
      ),
    );
    renderDetail();
    expect(await screen.findByRole("button", { name: "Pull" })).toBeDefined();
  });

  it("says nothing about pulling when nothing could be pulled", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(payload([kiri()]))));
    renderDetail();
    await screen.findByText("/projects/kiri");
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();
    expect(screen.queryByText(/nothing is behind/i)).toBeNull();
  });

  it("says when the repo last fetched, and leaves the workspace rescan to the listing", async () => {
    server.use(
      http.get("*/api/git", () =>
        HttpResponse.json(payload([kiri({ lastFetchedAt: new Date().toISOString() })])),
      ),
    );
    renderDetail();
    expect(await screen.findByText(/fetched .* ago|fetched now/i)).toBeDefined();
    // The rescan is workspace-wide, so it belongs on the listing, not here.
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByText(/scanned/i)).toBeNull();
  });
});
