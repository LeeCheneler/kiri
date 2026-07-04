import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { createQueryClient } from "../state/query-client.ts";
import { SessionArticleContent } from "./session-article-page.tsx";

const NOW = new Date("2026-05-09T12:00:00.000Z");

const SESSION_ID = "abc12345-0000-0000-0000-000000000000";

const renderArticle = (id: string, slug: string) => {
  const { factory, sources } = captureEventSources();
  const { hook } = memoryLocation({ path: `/sessions/${id}/articles/${slug}` });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <Router hook={hook}>
          <SessionArticleContent params={{ id, slug }} now={NOW} />
        </Router>
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...view, sources };
};

const articleJson = (id: string, slug: string, contentMd: string) => ({
  id: "art-1",
  sessionId: id,
  slug,
  name: "Meeting Notes",
  contentMd,
  createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
  heading: "Hello",
});

describe("<SessionArticlePage>", () => {
  it("shows a loading message while the article is being fetched", async () => {
    // A never-resolving handler keeps the page in the loading state while
    // we make the synchronous assertion.
    server.use(http.get("*/api/sessions/:id/articles/:slug", () => new Promise(() => {})));
    renderArticle(SESSION_ID, "notes");
    expect(screen.getByText(/loading article/i)).toBeDefined();
    await flushAsync();
  });

  it("renders the fetched article under its session context", async () => {
    server.use(
      http.get("*/api/sessions/:id/articles/:slug", ({ params }) =>
        HttpResponse.json(
          articleJson(params.id as string, params.slug as string, "# Hello\n\nFirst paragraph.\n"),
        ),
      ),
    );

    renderArticle(SESSION_ID, "notes");

    // The reader renders the fetched body, situated under the producing
    // session as the eyebrow context.
    expect(await screen.findByRole("heading", { level: 1, name: "Hello" })).toBeDefined();
    expect(screen.getByText("Session abc12345 · Meeting Notes")).toBeDefined();
    expect(screen.getByText(/First paragraph\./)).toBeDefined();
    // The breadcrumb threads Activity → session → (current article).
    expect(screen.getByRole("link", { name: /activity/i }).getAttribute("href")).toBe("/");
    const sessionLink = screen.getByRole("link", { name: "abc12345" });
    expect(sessionLink.getAttribute("href")).toBe(`/sessions/${SESSION_ID}`);
  });

  it("refetches and repaints when the session edits the article", async () => {
    let version = 0;
    server.use(
      http.get("*/api/sessions/:id/articles/:slug", ({ params }) => {
        version += 1;
        return HttpResponse.json(
          articleJson(
            params.id as string,
            params.slug as string,
            version === 1 ? "# Hello\n\nOriginal body.\n" : "# Hello\n\nEdited body.\n",
          ),
        );
      }),
    );

    const { sources } = renderArticle(SESSION_ID, "notes");
    expect(await screen.findByText(/Original body\./)).toBeDefined();

    // The server announces a write for this session and slug; the page
    // refetches and shows the edited body without a navigation.
    sources[0]?.emit({ type: "article.written", sessionId: SESSION_ID, slug: "notes" });

    expect(await screen.findByText(/Edited body\./)).toBeDefined();
    expect(screen.queryByText(/Original body\./)).toBeNull();
  });

  it("ignores writes announced for other sessions or slugs", async () => {
    let fetches = 0;
    server.use(
      http.get("*/api/sessions/:id/articles/:slug", ({ params }) => {
        fetches += 1;
        return HttpResponse.json(
          articleJson(params.id as string, params.slug as string, "# Hello\n\nBody.\n"),
        );
      }),
    );

    const { sources } = renderArticle(SESSION_ID, "notes");
    expect(await screen.findByText(/Body\./)).toBeDefined();

    sources[0]?.emit({ type: "article.written", sessionId: "other-session", slug: "notes" });
    sources[0]?.emit({ type: "article.written", sessionId: SESSION_ID, slug: "other-slug" });
    await flushAsync();

    expect(fetches).toBe(1);
  });

  it("renders the not-found view with a session breadcrumb when the API returns 404", async () => {
    server.use(
      http.get("*/api/sessions/:id/articles/:slug", () =>
        HttpResponse.json({ error: "article not found" }, { status: 404 }),
      ),
    );

    renderArticle("deadbeef-1111-2222-3333-444444444444", "missing-art");

    expect(await screen.findByRole("heading", { name: /article not found/i })).toBeDefined();
    // The names are shown so the user can spot a typo in the URL.
    expect(screen.getByText("deadbeef-1111-2222-3333-444444444444")).toBeDefined();
    expect(screen.getByText("missing-art")).toBeDefined();
    // Even on 404 the session stays reachable — it might still exist, only
    // the article is missing.
    const sessionLink = screen.getByRole("link", { name: "deadbeef" });
    expect(sessionLink.getAttribute("href")).toBe("/sessions/deadbeef-1111-2222-3333-444444444444");
  });

  it("renders a generic error view on non-404 failures", async () => {
    server.use(
      http.get(
        "*/api/sessions/:id/articles/:slug",
        () => new HttpResponse("boom", { status: 500 }),
      ),
    );

    renderArticle(SESSION_ID, "notes");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load article/i);
  });
});
