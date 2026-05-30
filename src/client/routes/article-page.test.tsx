import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { createQueryClient } from "../state/query-client.ts";
import { ArticleContent } from "./article-page.tsx";

const NOW = new Date("2026-05-09T12:00:00.000Z");

const renderArticle = (id: string, name: string) => {
  const { hook } = memoryLocation({ path: `/runs/${id}/published/${name}` });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={hook}>
        <ArticleContent params={{ id, name }} now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
};

describe("<ArticlePage>", () => {
  it("shows a loading message while the article is being fetched", async () => {
    // A never-resolving handler keeps the page in the loading state while
    // we make the synchronous assertion.
    server.use(http.get("*/api/runs/:id/published/:name", () => new Promise(() => {})));
    renderArticle("abc", "digest");
    expect(screen.getByText(/loading article/i)).toBeDefined();
    await flushAsync();
  });

  it("renders the title, breadcrumb trail, byline, and markdown body on the happy path", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          name: params.name,
          title: "PR Review Digest",
          contentMd: "# Hello\n\nFirst paragraph.\n\nSecond paragraph.\n",
          createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
          workflowName: "pr-review",
          heading: "Hello",
          gitSha: "abc1234567890abcdef1234567890abcdef123456",
          gitDirty: false,
          startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
          finishedAt: new Date(NOW.getTime() - 30_000).toISOString(),
        }),
      ),
    );

    renderArticle("abc12345-0000-0000-0000-000000000000", "digest");

    expect(
      await screen.findByRole("heading", { level: 2, name: "PR Review Digest" }),
    ).toBeDefined();
    // The breadcrumb threads Activity → workflow → run → (current article).
    expect(screen.getByRole("link", { name: /activity/i }).getAttribute("href")).toBe("/");
    const workflowLink = screen.getByRole("link", { name: "pr-review" });
    expect(workflowLink.getAttribute("href")).toBe("/workflows/pr-review");
    const runLink = screen.getByRole("link", { name: "abc12345" });
    expect(runLink.getAttribute("href")).toBe("/runs/abc12345-0000-0000-0000-000000000000");
    // The byline is article-centric: when it was published, plus the body's
    // word count and reading-time estimate. No run-execution facts.
    expect(screen.getByText(/30 seconds ago/i)).toBeDefined();
    expect(screen.getByText("5 words")).toBeDefined();
    expect(screen.getByText("1 min read")).toBeDefined();
    // The run's git sha and duration are not surfaced here. (Exact match: the
    // run crumb label "abc12345" must not be mistaken for a 7-char sha.)
    expect(screen.queryByText("abc1234")).toBeNull();
    expect(screen.queryByText(/\(dirty\)/)).toBeNull();
    // The only byline action is copy-markdown.
    expect(screen.getByRole("button", { name: /^copy markdown$/i })).toBeDefined();
    // Body markdown headings demote by two so authored `# Hello` slots under
    // the route's h2 title as an h3 element.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Hello" })).toBeDefined();
    expect(screen.getByText(/First paragraph\./)).toBeDefined();
    expect(screen.getByText(/Second paragraph\./)).toBeDefined();
  });

  it("renders the byline reading stats for a heading-less body", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          name: params.name,
          title: "Sparse",
          contentMd: "Body only, no heading.\n",
          createdAt: NOW.toISOString(),
          workflowName: "wf",
          heading: null,
          gitSha: null,
          gitDirty: null,
          startedAt: NOW.toISOString(),
          finishedAt: null,
        }),
      ),
    );

    renderArticle("abc", "sparse");

    expect(await screen.findByRole("heading", { level: 2, name: "Sparse" })).toBeDefined();
    expect(screen.getByText(/Body only/)).toBeDefined();
    // The byline reading stats are computed even when the body has no heading.
    expect(screen.getByText("4 words")).toBeDefined();
    expect(screen.getByText("1 min read")).toBeDefined();
  });

  it("renders body `# section` markdown as h3 with section-NN ids and § NN eyebrows", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          name: params.name,
          title: "Sectioned",
          contentMd: "# First section\n\nBody.\n\n# Second section\n\nMore.\n",
          createdAt: NOW.toISOString(),
          workflowName: "wf",
          heading: "First section",
          gitSha: null,
          gitDirty: null,
          startedAt: NOW.toISOString(),
          finishedAt: null,
        }),
      ),
    );

    const { container } = renderArticle("abc", "sectioned");

    expect(await screen.findByRole("heading", { level: 2, name: "Sectioned" })).toBeDefined();
    expect(container.querySelector("h1")).toBeNull();
    const bodyH3s = Array.from(container.querySelectorAll("h3[id^='section-']"));
    expect(bodyH3s.map((h) => h.id)).toEqual(["section-01", "section-02"]);
    expect(bodyH3s[0]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 01");
    expect(bodyH3s[1]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 02");
  });

  it("renders the not-found view with a run breadcrumb when the API returns 404", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", () =>
        HttpResponse.json({ error: "article not found" }, { status: 404 }),
      ),
    );

    renderArticle("deadbeef-1111-2222-3333-444444444444", "missing-art");

    expect(await screen.findByRole("heading", { name: /article not found/i })).toBeDefined();
    // The names are shown so the user can spot a typo in the URL.
    expect(screen.getByText("deadbeef-1111-2222-3333-444444444444")).toBeDefined();
    expect(screen.getByText("missing-art")).toBeDefined();
    // Even on 404 the run stays reachable — the run might still exist, only
    // the article is missing.
    const runLink = screen.getByRole("link", { name: "deadbeef" });
    expect(runLink.getAttribute("href")).toBe("/runs/deadbeef-1111-2222-3333-444444444444");
  });

  it("renders a generic error view on non-404 failures", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", () => new HttpResponse("boom", { status: 500 })),
    );

    renderArticle("abc", "digest");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load article/i);
  });
});
