import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import type { RepoOverview } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { FetchRepo } from "./fetch-repo.tsx";

const repo = (lastFetchedAt: string | null = null): RepoOverview =>
  ({
    name: "kiri",
    root: "/projects/kiri",
    gitCommonDir: "/projects/kiri/.git",
    defaultBranch: "main",
    lastFetchedAt,
    worktrees: [],
  }) as RepoOverview;

const renderFetch = (subject: RepoOverview = repo()) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <FetchRepo repo={subject} />
    </QueryClientProvider>,
  );

const answers = (body: Record<string, unknown>) => {
  server.use(http.post("*/api/git/fetch", () => HttpResponse.json(body)));
};

describe("<FetchRepo>", () => {
  it("offers the fetch whatever state the repo is in — nothing can know it is stale first", () => {
    renderFetch();
    expect(screen.getByRole("button", { name: "Fetch" })).toBeDefined();
  });

  it("says when the repo last fetched, from git's own record", () => {
    renderFetch(repo(new Date().toISOString()));
    expect(screen.getByText(/fetched .* ago|fetched now/i)).toBeDefined();
  });

  it("says a repo has never fetched rather than passing it off as just now", () => {
    renderFetch();
    expect(screen.getByText(/never fetched/i)).toBeDefined();
  });

  it.each([
    ["updated", ["   abc1234..def5678  main -> origin/main"]],
    ["up-to-date", []],
  ] as const)("reports nothing at all after a fetch that %s", async (status, updates) => {
    answers({ repo: "kiri", status, updates });
    renderFetch();

    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /fetching/i })).toBeNull());
    // What a fetch moved shows up in the checkouts the page already renders.
    expect(screen.queryByText(status)).toBeNull();
    expect(screen.queryByText(/main -> origin\/main/)).toBeNull();
  });

  it("names a fetch that failed, with git's own message", async () => {
    answers({ repo: "kiri", status: "failed", updates: [], error: "could not resolve host" });
    renderFetch();

    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    expect(await screen.findByText(/could not resolve host/i)).toBeDefined();
    expect(screen.getByText("failed")).toBeDefined();
  });

  it("names the reason a fetch was refused", async () => {
    answers({ repo: "kiri", status: "refused", updates: [], reason: "the repo has no remote" });
    renderFetch();

    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    expect(await screen.findByText(/no remote/i)).toBeDefined();
    expect(screen.getByText("refused")).toBeDefined();
  });

  it("surfaces a request that never reached the server", async () => {
    server.use(http.post("*/api/git/fetch", () => new HttpResponse(null, { status: 500 })));
    renderFetch();

    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    expect(await screen.findByText(/couldn't fetch/i)).toBeDefined();
  });
});
