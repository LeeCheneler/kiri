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
    // Body markdown headings demote by two so authored `# Hello` slots
    // under the route's h2 title as an h3 element (with the visual
    // prominence of an authored h1 preserved).
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Hello" })).toBeDefined();
    expect(screen.getByText(/First paragraph\./)).toBeDefined();
    expect(screen.getByText(/Second paragraph\./)).toBeDefined();
  });

  it("omits duration and git ref from the byline when the underlying fields are null", async () => {
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
    expect(screen.queryByText(/Body only/)).toBeDefined();
    // Run hasn't finished — no duration appears in the byline.
    expect(screen.queryByText(/\d+m \d+s|\d+(?:\.\d+)?s|\d+ms/)).toBeNull();
    // Git context absent — no short sha, no (dirty).
    expect(screen.queryByText(/\(dirty\)/)).toBeNull();
  });

  it("renders body `# section` markdown as h3 with section-NN ids and § NN eyebrows", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          name: params.name,
          title: "Sectioned",
          // Author writes `# Section` — the article surface demotes by two
          // so the rendered element is an h3 carrying the section anchor.
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
