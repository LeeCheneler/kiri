import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../tests/setup/msw.ts";
import { createQueryClient } from "../state/query-client.ts";
import { GitRepoPage } from "./git-repo-page.tsx";

const overview = (names: string[]) => ({
  roots: ["/projects"],
  refreshing: false,
  scannedAt: new Date().toISOString(),
  repos: names.map((name) => ({
    name,
    root: `/projects/${name}`,
    gitCommonDir: `/projects/${name}/.git`,
    defaultBranch: "main",
    lastFetchedAt: null,
    worktrees: [],
  })),
});

const renderPage = (repo: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={memoryLocation({ path: `/git/${repo}` }).hook}>
        <GitRepoPage params={{ repo }} />
      </Router>
    </QueryClientProvider>,
  );

describe("<GitRepoPage>", () => {
  it("decodes a repo name the URL had to escape", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(overview(["my repo"]))));
    renderPage("my%20repo");
    expect(await screen.findByRole("heading", { level: 2, name: /my repo/i })).toBeDefined();
  });

  it("falls back to the raw param when the URL carries a malformed escape", async () => {
    // `%E0` is an incomplete UTF-8 byte and makes decodeURIComponent throw; the
    // route must still resolve, to not-found, rather than crashing.
    server.use(http.get("*/api/git", () => HttpResponse.json(overview(["kiri"]))));
    renderPage("alpha%E0");
    expect(await screen.findByText(/repo not found/i)).toBeDefined();
    expect(screen.getByText("alpha%E0")).toBeDefined();
  });
});
