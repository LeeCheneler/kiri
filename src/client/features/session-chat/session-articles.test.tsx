import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { server } from "../../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../../events/live.tsx";
import { useSessionArticlesLive } from "../../state/articles.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionArticles } from "./session-articles.tsx";

const SESSION_ID = "abc12345-0000-0000-0000-000000000000";

// The root-level article live bridge, as `<LiveSync>` mounts it in the app.
const Live = () => {
  useSessionArticlesLive();
  return null;
};

const summary = (slug: string, heading: string | null) => ({
  slug,
  name: "Notes",
  heading,
  createdAt: new Date().toISOString(),
});

const renderPanel = (id: string) => {
  const { factory, sources } = captureEventSources();
  const { hook } = memoryLocation({ path: `/sessions/${id}` });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <Live />
        <Router hook={hook}>
          <SessionArticles id={id} />
        </Router>
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...view, sources };
};

describe("<SessionArticles>", () => {
  it("renders nothing while the session has written no articles", async () => {
    server.use(http.get("*/api/sessions/:id/articles", () => HttpResponse.json({ articles: [] })));

    const { container } = renderPanel(SESSION_ID);
    await flushAsync();

    expect(container.innerHTML).toBe("");
  });

  it("lists the session's articles as links, read by heading with name fallback", async () => {
    server.use(
      http.get("*/api/sessions/:id/articles", () =>
        HttpResponse.json({
          articles: [summary("digest", "Morning Digest"), summary("scratch", null)],
        }),
      ),
    );

    renderPanel(SESSION_ID);

    const headed = await screen.findByRole("link", { name: "Morning Digest" });
    expect(headed.getAttribute("href")).toBe(`/sessions/${SESSION_ID}/articles/digest`);
    // A heading-less article falls back to its name.
    const fallback = screen.getByRole("link", { name: "Notes" });
    expect(fallback.getAttribute("href")).toBe(`/sessions/${SESSION_ID}/articles/scratch`);
  });

  it("pops a newly written article into the list when the server announces it", async () => {
    let written = false;
    server.use(
      http.get("*/api/sessions/:id/articles", () =>
        HttpResponse.json({ articles: written ? [summary("digest", "Morning Digest")] : [] }),
      ),
    );

    const { sources, container } = renderPanel(SESSION_ID);
    await flushAsync();
    expect(container.innerHTML).toBe("");

    written = true;
    sources[0]?.emit({ type: "article.written", sessionId: SESSION_ID, slug: "digest" });

    expect(await screen.findByRole("link", { name: "Morning Digest" })).toBeDefined();
  });

  it("ignores writes announced for other sessions", async () => {
    let fetches = 0;
    server.use(
      http.get("*/api/sessions/:id/articles", () => {
        fetches += 1;
        return HttpResponse.json({ articles: [summary("digest", "Morning Digest")] });
      }),
    );

    const { sources } = renderPanel(SESSION_ID);
    await screen.findByRole("link", { name: "Morning Digest" });

    sources[0]?.emit({ type: "article.written", sessionId: "other-session", slug: "digest" });
    await flushAsync();

    expect(fetches).toBe(1);
  });

  const serveProjectSession = (projectId: string | null) =>
    server.use(
      http.get("*/api/sessions/:id", ({ params }) =>
        HttpResponse.json({
          session: {
            id: params.id,
            status: "idle",
            model: "anthropic:claude",
            imageModel: null,
            effort: "medium",
            cwd: null,
            title: null,
            projectId,
            parentSessionId: null,
            parentToolCallId: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            error: null,
          },
          messages: [],
        }),
      ),
    );

  it("shows the project's shared corpus instead for a project session", async () => {
    serveProjectSession("p1");
    server.use(
      http.get("*/api/projects/:id", () =>
        HttpResponse.json({
          project: { id: "p1", name: "Research", createdAt: new Date().toISOString() },
          articles: [summary("corpus-doc", "Field Notes"), summary("scratch", null)],
          sessions: [],
        }),
      ),
    );

    renderPanel(SESSION_ID);

    const projectLink = await screen.findByRole("link", { name: "Research" });
    expect(projectLink.getAttribute("href")).toBe("/projects/p1");
    const corpusLink = screen.getByRole("link", { name: "Field Notes" });
    expect(corpusLink.getAttribute("href")).toBe("/projects/p1/articles/corpus-doc");
    // A heading-less corpus article falls back to its name.
    expect(screen.getByRole("link", { name: "Notes" }).getAttribute("href")).toBe(
      "/projects/p1/articles/scratch",
    );
  });

  it("keeps the project link even while the corpus is empty", async () => {
    serveProjectSession("p1");
    server.use(
      http.get("*/api/projects/:id", () =>
        HttpResponse.json({
          project: { id: "p1", name: "Research", createdAt: new Date().toISOString() },
          articles: [],
          sessions: [],
        }),
      ),
    );

    renderPanel(SESSION_ID);

    expect(await screen.findByRole("link", { name: "Research" })).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
