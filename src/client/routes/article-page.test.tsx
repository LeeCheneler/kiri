import { describe, expect, it, mock } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { createQueryClient } from "../state/query-client.ts";
import { ArticleContent } from "./article-page.tsx";

const NOW = new Date("2026-05-09T12:00:00.000Z");

const renderArticle = (id: string, slug: string) => {
  const { hook } = memoryLocation({ path: `/runs/${id}/published/${slug}` });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={hook}>
        <ArticleContent params={{ id, slug }} now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
};

describe("<ArticlePage>", () => {
  it("shows a loading message while the article is being fetched", async () => {
    // A never-resolving handler keeps the page in the loading state while
    // we make the synchronous assertion.
    server.use(http.get("*/api/runs/:id/published/:slug", () => new Promise(() => {})));
    renderArticle("abc", "digest");
    expect(screen.getByText(/loading article/i)).toBeDefined();
    await flushAsync();
  });

  it("renders the title, breadcrumb trail, byline, and markdown body on the happy path", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          slug: params.slug,
          name: "PR Review Digest",
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

    // The body's `# Hello` becomes the page title (an h1); the publish title
    // rides in the eyebrow as the series label.
    expect(await screen.findByRole("heading", { level: 1, name: "Hello" })).toBeDefined();
    expect(screen.getByText("pr-review · PR Review Digest")).toBeDefined();
    // The breadcrumb threads Activity → workflow → run → (current article).
    expect(screen.getByRole("link", { name: /activity/i }).getAttribute("href")).toBe("/");
    const workflowLink = screen.getByRole("link", { name: "pr-review" });
    expect(workflowLink.getAttribute("href")).toBe("/workflows/pr-review");
    const runLink = screen.getByRole("link", { name: "abc12345" });
    expect(runLink.getAttribute("href")).toBe("/runs/abc12345-0000-0000-0000-000000000000");
    // The byline is article-centric: when it was published, plus the body's
    // word count and reading-time estimate. No run-execution facts. The word
    // count is of the body, with the headline lifted out.
    expect(screen.getByText(/30 seconds ago/i)).toBeDefined();
    expect(screen.getByText("4 words")).toBeDefined();
    expect(screen.getByText("1 min read")).toBeDefined();
    // The run's git sha and duration are not surfaced here. (Exact match: the
    // run crumb label "abc12345" must not be mistaken for a 7-char sha.)
    expect(screen.queryByText("abc1234")).toBeNull();
    expect(screen.queryByText(/\(dirty\)/)).toBeNull();
    // The only byline action is copy-markdown.
    expect(screen.getByRole("button", { name: /^copy markdown$/i })).toBeDefined();
    // The headline is lifted out of the body, so the page carries exactly one
    // h1 and the headline is not also rendered as a body heading.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/First paragraph\./)).toBeDefined();
    expect(screen.getByText(/Second paragraph\./)).toBeDefined();
  });

  it("copies the cleaned article — headline plus preamble-stripped body — on click", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          slug: params.slug,
          name: "Demo",
          contentMd: "Sure, here's the article:\n\n# The Headline\n\n## Section\n\nBody copy.",
          createdAt: NOW.toISOString(),
          workflowName: "wf",
          heading: "The Headline",
          gitSha: null,
          gitDirty: null,
          startedAt: NOW.toISOString(),
          finishedAt: null,
        }),
      ),
    );

    const writeText = mock(async (_text: string) => {});
    // userEvent.setup() stubs navigator.clipboard, so install the mock after it.
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    renderArticle("abc", "demo");

    await user.click(await screen.findByRole("button", { name: /^copy markdown$/i }));

    // The lead-in chatter is gone and the headline is re-emitted as a `#` line.
    expect(writeText.mock.calls).toEqual([["# The Headline\n\n## Section\n\nBody copy."]]);
  });

  it("renders the byline reading stats for a heading-less body", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          slug: params.slug,
          name: "Sparse",
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

    // With no body headline, the publish title supplies the page title and the
    // eyebrow keeps the generic "Article" label.
    expect(await screen.findByRole("heading", { level: 1, name: "Sparse" })).toBeDefined();
    expect(screen.getByText("wf · Article")).toBeDefined();
    expect(screen.getByText(/Body only/)).toBeDefined();
    // The byline reading stats are computed even when the body has no heading.
    expect(screen.getByText("4 words")).toBeDefined();
    expect(screen.getByText("1 min read")).toBeDefined();
  });

  it("drops the eyebrow series label when the publish title restates the workflow name", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          slug: params.slug,
          name: "Daily Briefing",
          contentMd: "# Wednesday's briefing\n\n## Lead\n\nBody.\n",
          createdAt: NOW.toISOString(),
          workflowName: "Daily Briefing",
          heading: "Wednesday's briefing",
          gitSha: null,
          gitDirty: null,
          startedAt: NOW.toISOString(),
          finishedAt: null,
        }),
      ),
    );

    renderArticle("abc", "briefing");

    // The publish title equals the workflow name, so it adds nothing — the
    // eyebrow keeps the generic "Article" label rather than echoing it.
    expect(
      await screen.findByRole("heading", { level: 1, name: "Wednesday's briefing" }),
    ).toBeDefined();
    expect(screen.getByText("Daily Briefing · Article")).toBeDefined();
  });

  it("renders body `## section` markdown as h2 with section-NN ids and § NN eyebrows", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          slug: params.slug,
          name: "Sectioned",
          contentMd: "# The headline\n\n## First section\n\nBody.\n\n## Second section\n\nMore.\n",
          createdAt: NOW.toISOString(),
          workflowName: "wf",
          heading: "The headline",
          gitSha: null,
          gitDirty: null,
          startedAt: NOW.toISOString(),
          finishedAt: null,
        }),
      ),
    );

    const { container } = renderArticle("abc", "sectioned");

    // The headline is the page h1; the `##` headings are the sections that the
    // table of contents reads, each stamped with a section-NN id and § eyebrow.
    expect(await screen.findByRole("heading", { level: 1, name: "The headline" })).toBeDefined();
    const bodyH2s = Array.from(container.querySelectorAll("h2[id^='section-']"));
    expect(bodyH2s.map((h) => h.id)).toEqual(["section-01", "section-02"]);
    expect(bodyH2s[0]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 01");
    expect(bodyH2s[1]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 02");
  });

  it("renders the not-found view with a run breadcrumb when the API returns 404", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:slug", () =>
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
      http.get("*/api/runs/:id/published/:slug", () => new HttpResponse("boom", { status: 500 })),
    );

    renderArticle("abc", "digest");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load article/i);
  });
});
