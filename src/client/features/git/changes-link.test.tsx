import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { RepoOverview, WorktreeStatus } from "../../api.ts";
import { ChangesLink } from "./changes-link.tsx";

const worktree = (overrides: Record<string, unknown> = {}): WorktreeStatus =>
  ({
    path: "/projects/kiri-feat-search",
    branch: "feat/search",
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
  }) as WorktreeStatus;

const repo = (defaultBranch: string | null = "main"): RepoOverview =>
  ({
    name: "kiri",
    root: "/projects/kiri",
    defaultBranch,
    worktrees: [],
  }) as unknown as RepoOverview;

const renderLink = (subject: WorktreeStatus, overview = repo()) =>
  render(
    <Router hook={memoryLocation({ path: "/git/kiri" }).hook}>
      <ChangesLink repo={overview} worktree={subject} />
    </Router>,
  );

const href = () => screen.getByRole("link").getAttribute("href");

describe("<ChangesLink>", () => {
  it("leads a dirty checkout to its working tree", () => {
    renderLink(worktree({ dirty: true }));
    expect(href()).toBe("/git/kiri/changes/kiri-feat-search?view=uncommitted");
  });

  it("leads a clean checkout to what its branch introduces", () => {
    renderLink(worktree());
    expect(href()).toBe("/git/kiri/changes/kiri-feat-search?view=branch");
  });

  it("addresses the primary checkout by the repo's own directory name", () => {
    renderLink(worktree({ path: "/projects/kiri", branch: "feat/x", primary: true }));
    expect(href()).toBe("/git/kiri/changes/kiri?view=branch");
  });

  it("withholds the link when the scan already proves both views are empty", () => {
    renderLink(worktree({ path: "/projects/kiri", branch: "main", primary: true }));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("still links a detached checkout, which has a merge-base worth reading", () => {
    renderLink(worktree({ branch: null, detached: true }));
    expect(href()).toBe("/git/kiri/changes/kiri-feat-search?view=branch");
  });

  it("still links a checkout when the repo has no default branch to sit on", () => {
    renderLink(worktree({ branch: null }), repo(null));
    expect(href()).toBe("/git/kiri/changes/kiri-feat-search?view=branch");
  });

  it("escapes a repo name the URL has to encode", () => {
    renderLink(worktree(), { ...repo(), name: "my repo" });
    expect(href()).toBe("/git/my%20repo/changes/kiri-feat-search?view=branch");
  });
});
