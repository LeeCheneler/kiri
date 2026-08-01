import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../tests/setup/msw.ts";
import { createQueryClient } from "../state/query-client.ts";
import { GitChangesPage } from "./git-changes-page.tsx";

const overview = (name: string, checkout: string) => ({
  roots: ["/projects"],
  refreshing: false,
  scannedAt: new Date().toISOString(),
  repos: [
    {
      name,
      root: `/projects/${name}`,
      gitCommonDir: `/projects/${name}/.git`,
      defaultBranch: "main",
      worktrees: [
        {
          path: `/projects/${checkout}`,
          branch: "feat/thing",
          detached: false,
          head: "abc1234",
          dirty: true,
          ahead: 0,
          behind: 0,
          upstreamGone: false,
          locked: false,
          prunable: false,
          primary: false,
        },
      ],
    },
  ],
});

const renderPage = (repo: string, checkout: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={memoryLocation({ path: `/git/${repo}/changes/${checkout}` }).hook}>
        <GitChangesPage params={{ repo, checkout }} />
      </Router>
    </QueryClientProvider>,
  );

describe("<GitChangesPage>", () => {
  it("decodes params the URL had to escape", async () => {
    server.use(
      http.get("*/api/git", () => HttpResponse.json(overview("my repo", "my checkout"))),
      http.get("*/api/git/changeset", () =>
        HttpResponse.json({
          view: "uncommitted",
          files: [],
          totalFiles: 0,
          truncated: false,
          mergeBase: null,
          emptyReason: null,
        }),
      ),
    );
    renderPage("my%20repo", "my%20checkout");
    expect(await screen.findByRole("heading", { level: 2, name: /my checkout/i })).toBeDefined();
  });

  it("falls back to the raw params when the URL carries a malformed escape", async () => {
    // `%E0` is an incomplete UTF-8 byte and makes decodeURIComponent throw; the
    // route must still resolve, to not-found, rather than crashing.
    server.use(http.get("*/api/git", () => HttpResponse.json(overview("kiri", "kiri-feat"))));
    renderPage("kiri", "alpha%E0");
    expect(await screen.findByText(/checkout not found/i)).toBeDefined();
    expect(screen.getByText("alpha%E0")).toBeDefined();
  });
});
