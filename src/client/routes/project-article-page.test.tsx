import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { useProjectsLive } from "../state/projects.ts";
import { createQueryClient } from "../state/query-client.ts";
import { ProjectArticleContent } from "./project-article-page.tsx";

const NOW = new Date("2026-08-07T12:00:00.000Z");

const PROJECT_ID = "abc12345-0000-0000-0000-000000000000";

// The root-level project live bridge, as `<LiveSync>` mounts it in the app.
const Live = () => {
  useProjectsLive();
  return null;
};

const renderArticle = (id: string, slug: string) => {
  const { factory, sources } = captureEventSources();
  const { hook, history } = memoryLocation({
    path: `/projects/${id}/articles/${slug}`,
    record: true,
  });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <Live />
        <Router hook={hook}>
          <ProjectArticleContent params={{ id, slug }} now={NOW} />
        </Router>
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...view, sources, history };
};

const articleJson = (id: string, slug: string, contentMd: string) => ({
  id: "art-1",
  projectId: id,
  slug,
  name: "Corpus Doc",
  contentMd,
  createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
  heading: "Hello",
});

const projectJson = (id: string) => ({
  project: { id, name: "Research", createdAt: new Date(NOW.getTime() - 60_000).toISOString() },
  articles: [],
  sessions: [],
});

const serveProject = () =>
  server.use(
    http.get("*/api/projects/:id", ({ params }) =>
      HttpResponse.json(projectJson(params.id as string)),
    ),
  );

describe("<ProjectArticlePage>", () => {
  it("shows a loading message while the article is being fetched", async () => {
    // A never-resolving handler keeps the page in the loading state while
    // we make the synchronous assertion.
    server.use(
      http.get("*/api/projects/:id/articles/:slug", () => new Promise(() => {})),
      http.get("*/api/projects/:id", () => new Promise(() => {})),
    );
    renderArticle(PROJECT_ID, "corpus-doc");
    expect(screen.getByText(/loading article/i)).toBeDefined();
    await flushAsync();
  });

  it("renders the fetched article under its project context", async () => {
    serveProject();
    server.use(
      http.get("*/api/projects/:id/articles/:slug", ({ params }) =>
        HttpResponse.json(
          articleJson(params.id as string, params.slug as string, "# Hello\n\nFirst paragraph.\n"),
        ),
      ),
    );

    renderArticle(PROJECT_ID, "corpus-doc");

    // The reader renders the fetched body, situated under the owning
    // project as the eyebrow context.
    expect(await screen.findByRole("heading", { level: 1, name: "Hello" })).toBeDefined();
    expect(await screen.findByText("Project Research · Corpus Doc")).toBeDefined();
    expect(screen.getByText(/First paragraph\./)).toBeDefined();
    // The breadcrumb threads Projects → project → (current article).
    expect(screen.getByRole("link", { name: /projects/i }).getAttribute("href")).toBe("/projects");
    const projectLink = screen.getByRole("link", { name: "Research" });
    expect(projectLink.getAttribute("href")).toBe(`/projects/${PROJECT_ID}`);
  });

  it("refetches and repaints when the project's corpus changes", async () => {
    let version = 0;
    serveProject();
    server.use(
      http.get("*/api/projects/:id/articles/:slug", ({ params }) => {
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

    const { sources } = renderArticle(PROJECT_ID, "corpus-doc");
    expect(await screen.findByText(/Original body\./)).toBeDefined();

    // The server announces a change on this project; the page refetches and
    // shows the edited body without a navigation.
    sources[0]?.emit({ type: "project.updated", id: PROJECT_ID });

    expect(await screen.findByText(/Edited body\./)).toBeDefined();
    expect(screen.queryByText(/Original body\./)).toBeNull();
  });

  it("links [[slug]] references to their corpus targets, leaving unknown slugs literal", async () => {
    server.use(
      http.get("*/api/projects/:id", ({ params }) =>
        HttpResponse.json({
          project: {
            id: params.id,
            name: "Research",
            createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
          },
          articles: [
            {
              slug: "level-design",
              name: "Level Design",
              heading: "Level Design Notes",
              createdAt: new Date(NOW.getTime() - 45_000).toISOString(),
            },
          ],
          sessions: [],
        }),
      ),
      http.get("*/api/projects/:id/articles/:slug", ({ params }) =>
        HttpResponse.json(
          articleJson(
            params.id as string,
            params.slug as string,
            "# Hello\n\nSee [[level-design]] and [[missing-doc]].",
          ),
        ),
      ),
    );

    renderArticle(PROJECT_ID, "corpus-doc");

    const link = await screen.findByRole("link", { name: "Level Design Notes" });
    expect(link.getAttribute("href")).toBe(`/projects/${PROJECT_ID}/articles/level-design`);
    // A slug nothing in the corpus owns stays as written.
    expect(screen.getByText(/\[\[missing-doc\]\]/)).toBeDefined();
  });

  it("deletes the article behind a confirm and returns to the project", async () => {
    let deleted = false;
    serveProject();
    server.use(
      http.get("*/api/projects/:id/articles/:slug", ({ params }) =>
        HttpResponse.json(
          articleJson(params.id as string, params.slug as string, "# Hello\n\nBody."),
        ),
      ),
      http.delete("*/api/projects/:id/articles/:slug", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { history } = renderArticle(PROJECT_ID, "corpus-doc");
    await userEvent.click(await screen.findByRole("button", { name: "delete article" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(history[history.length - 1]).toBe(`/projects/${PROJECT_ID}`));
    expect(deleted).toBe(true);
  });

  it("renders the not-found view with a project breadcrumb when the API returns 404", async () => {
    serveProject();
    server.use(
      http.get("*/api/projects/:id/articles/:slug", () =>
        HttpResponse.json({ error: "article not found" }, { status: 404 }),
      ),
    );

    renderArticle(PROJECT_ID, "missing-doc");

    expect(await screen.findByRole("heading", { name: /article not found/i })).toBeDefined();
    // The slug is shown so the user can spot a typo in the URL.
    expect(screen.getByText("missing-doc")).toBeDefined();
    // Even on 404 the project stays reachable — it might still exist, only
    // the article is missing.
    const projectLink = await screen.findByRole("link", { name: "Research" });
    expect(projectLink.getAttribute("href")).toBe(`/projects/${PROJECT_ID}`);
  });

  it("renders a generic error view on non-404 failures", async () => {
    serveProject();
    server.use(
      http.get(
        "*/api/projects/:id/articles/:slug",
        () => new HttpResponse("boom", { status: 500 }),
      ),
    );

    renderArticle(PROJECT_ID, "corpus-doc");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load article/i);
  });
});
