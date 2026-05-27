import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../tests/setup/msw.ts";
import { ArticlePage } from "./article-page.tsx";

afterEach(() => cleanup());

const NOW = new Date("2026-05-09T12:00:00.000Z");

const renderArticle = (id: string, name: string) => {
  const { hook } = memoryLocation({ path: `/runs/${id}/published/${name}` });
  return render(
    <Router hook={hook}>
      <ArticlePage params={{ id, name }} now={NOW} />
    </Router>,
  );
};

describe("<ArticlePage>", () => {
  it("shows a loading message while the article is being fetched", () => {
    // A never-resolving handler keeps the page in the loading state while
    // we make the synchronous assertion. Avoids MSW's "no matching handler"
    // warning that the default-route fallback would otherwise emit.
    server.use(http.get("*/api/runs/:id/published/:name", () => new Promise(() => {})));
    renderArticle("abc", "digest");
    expect(screen.getByText(/loading article/i)).toBeDefined();
  });

  it("renders the title, workflow, run link, created-at, and markdown body on the happy path", async () => {
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
    // Workflow name appears once, inside the byline sentence as a link
    // back to the workflow page.
    const workflowLink = screen.getByRole("link", { name: "pr-review" });
    expect(workflowLink.getAttribute("href")).toBe("/workflows/pr-review");
    // Sub-byline surfaces the article body's first heading — distinct from
    // the markdown <h1> that also reads "Hello", so query the <p> directly.
    expect(screen.getByText("Hello", { selector: "p" })).toBeDefined();
    // Byline duration reads the run's lifecycle window — 60s → 30s = 30s.
    expect(screen.getByText("30s")).toBeDefined();
    // Short-form git sha; no (dirty) when gitDirty is false.
    expect(screen.getByText("abc1234")).toBeDefined();
    expect(screen.queryByText(/\(dirty\)/)).toBeNull();
    // Secondary actions: open-run link to the run detail, copy markdown
    // as a text link rather than a bordered button.
    const openRun = screen.getByRole("link", { name: /open run/i });
    expect(openRun.getAttribute("href")).toBe("/runs/abc12345-0000-0000-0000-000000000000");
    expect(screen.getByRole("button", { name: /^copy markdown$/i })).toBeDefined();
    // Back link sits above the header.
    const backLink = screen.getByRole("link", { name: /back to run/i });
    expect(backLink.getAttribute("href")).toBe("/runs/abc12345-0000-0000-0000-000000000000");
    // Markdown body is rendered through <Markdown> — headings and
    // paragraphs both make it into the tree.
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeDefined();
    expect(screen.getByText(/First paragraph\./)).toBeDefined();
    expect(screen.getByText(/Second paragraph\./)).toBeDefined();
  });

  it("omits the sub-byline, duration, and git ref when the underlying fields are null", async () => {
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
    // Body has no leading "# heading" — sub-byline is absent.
    expect(screen.queryByText(/Body only/)).toBeDefined();
    // Run hasn't finished — no duration appears in the byline.
    expect(screen.queryByText(/\d+m \d+s|\d+(?:\.\d+)?s|\d+ms/)).toBeNull();
    // Git context absent — no short sha, no (dirty).
    expect(screen.queryByText(/\(dirty\)/)).toBeNull();
  });

  it("renders the (dirty) marker when the run's working tree was dirty", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          name: params.name,
          title: "Dirty Tree",
          contentMd: "# h\n\nbody\n",
          createdAt: NOW.toISOString(),
          workflowName: "wf",
          heading: "h",
          gitSha: "abc1234567890abcdef1234567890abcdef123456",
          gitDirty: true,
          startedAt: new Date(NOW.getTime() - 5_000).toISOString(),
          finishedAt: NOW.toISOString(),
        }),
      ),
    );

    renderArticle("abc", "dirty");

    expect(await screen.findByRole("heading", { level: 2, name: "Dirty Tree" })).toBeDefined();
    expect(screen.getByText("abc1234")).toBeDefined();
    expect(screen.getByText(/\(dirty\)/)).toBeDefined();
  });

  it("renders the not-found view when the API returns 404", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", () =>
        HttpResponse.json({ error: "article not found" }, { status: 404 }),
      ),
    );

    renderArticle("missing-run", "missing-art");

    expect(await screen.findByRole("heading", { name: /article not found/i })).toBeDefined();
    // The names are shown so the user can spot a typo in the URL.
    expect(screen.getByText("missing-run")).toBeDefined();
    expect(screen.getByText("missing-art")).toBeDefined();
    // Even on 404, the back link points at the run page rather than home —
    // the run might still exist; only the article is missing.
    const backLink = screen.getByRole("link", { name: /back to run/i });
    expect(backLink.getAttribute("href")).toBe("/runs/missing-run");
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

  it("ignores a stale response when params change mid-flight", async () => {
    // First request: never resolves — second request must still be the
    // one that paints. Without the token guard the late first response
    // would clobber the freshly-loaded second article.
    const responders: Array<(value: Response) => void> = [];
    server.use(
      http.get(
        "*/api/runs/:id/published/:name",
        ({ params }) =>
          new Promise<Response>((resolve) => {
            if (params.name === "first") {
              responders.push(resolve);
              return;
            }
            resolve(
              HttpResponse.json({
                id: "art-2",
                runId: params.id,
                name: params.name,
                title: "Second Article",
                contentMd: "second body\n",
                createdAt: NOW.toISOString(),
                workflowName: "wf",
                heading: null,
                gitSha: null,
                gitDirty: null,
                startedAt: NOW.toISOString(),
                finishedAt: null,
              }),
            );
          }),
      ),
    );

    const { rerender } = renderArticle("abc", "first");
    rerender(
      <Router hook={memoryLocation({ path: "/runs/abc/published/second" }).hook}>
        <ArticlePage params={{ id: "abc", name: "second" }} now={NOW} />
      </Router>,
    );
    expect(await screen.findByRole("heading", { name: "Second Article" })).toBeDefined();

    // Late response for "first" — should be ignored.
    responders[0]?.(
      HttpResponse.json({
        id: "art-1",
        runId: "abc",
        name: "first",
        title: "First Article",
        contentMd: "stale\n",
        createdAt: NOW.toISOString(),
        workflowName: "wf",
        heading: null,
        gitSha: null,
        gitDirty: null,
        startedAt: NOW.toISOString(),
        finishedAt: null,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("heading", { name: "First Article" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Second Article" })).toBeDefined();
  });
});
