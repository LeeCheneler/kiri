import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { articles, projects, sessions } from "../db/schema.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import { createApp } from "../index.ts";
import { appendMessage, createSession } from "../sessions/store.ts";
import { CLIENT_HEADERS, type TestEnv, createTestEnv } from "./test-helpers.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

describe("projects routes", () => {
  let env: TestEnv;
  let bus: EventBus;
  let events: KiriEvent[];

  beforeEach(() => {
    env = createTestEnv();
    bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event));
  });

  afterEach(() => {
    env.dispose();
  });

  const buildApp = (): ReturnType<typeof createApp> =>
    createApp({ db: env.db, registry: env.registry, config: env.config, env: {}, bus });

  const seedProject = (id: string, name = "Research", createdAt = new Date()) => {
    env.db.insert(projects).values({ id, name, createdAt }).run();
  };

  const seedArticle = (
    id: string,
    projectId: string,
    slug: string,
    contentMd = "# Doc\n\nBody.",
  ) => {
    env.db
      .insert(articles)
      .values({ id, projectId, slug, name: "Doc", contentMd, createdAt: new Date() })
      .run();
  };

  describe("GET /api/projects", () => {
    it("returns an empty list on a fresh workspace", async () => {
      const res = await buildApp().request("/api/projects");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ projects: [] });
    });

    it("lists projects newest first with corpus and session counts", async () => {
      seedProject("p1", "Older", new Date(1000));
      seedProject("p2", "Newer", new Date(2000));
      seedArticle("a1", "p1", "doc-one");
      seedArticle("a2", "p1", "doc-two");
      createSession(env.db, MODEL, { id: "s1", projectId: "p1" });
      // A delegate child stays inside its parent's transcript — it must not
      // inflate the project's session count.
      createSession(env.db, MODEL, {
        id: "c1",
        projectId: "p1",
        parentSessionId: "s1",
        parentToolCallId: "t1",
      });

      const res = await buildApp().request("/api/projects");
      const body = (await res.json()) as {
        projects: { id: string; articleCount: number; sessionCount: number }[];
      };
      expect(body.projects.map((project) => project.id)).toEqual(["p2", "p1"]);
      expect(body.projects[1]).toMatchObject({ articleCount: 2, sessionCount: 1 });
      expect(body.projects[0]).toMatchObject({ articleCount: 0, sessionCount: 0 });
    });
  });

  describe("POST /api/projects", () => {
    const post = (body: unknown) =>
      buildApp().request("/api/projects", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("creates a project, trims the name, and publishes project.created", async () => {
      const res = await post({ name: "  Research  " });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { project: { id: string; name: string } };
      expect(body.project.name).toBe("Research");
      expect(events).toContainEqual({ type: "project.created", id: body.project.id });
    });

    it("400s a blank name", async () => {
      const res = await post({ name: "   " });
      expect(res.status).toBe(400);
    });

    it("rejects unknown fields", async () => {
      const res = await post({ name: "Research", slug: "research" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/projects/:id", () => {
    it("returns the project with its article and session indexes", async () => {
      seedProject("p1");
      seedArticle("a1", "p1", "corpus-doc", "# Corpus Doc\n\nBody.");
      createSession(env.db, MODEL, { id: "s1", projectId: "p1", title: "Titled" });
      appendMessage(env.db, "s1", { role: "user", parts: [{ type: "text", text: "hello there" }] });
      createSession(env.db, MODEL, {
        id: "c1",
        projectId: "p1",
        parentSessionId: "s1",
        parentToolCallId: "t1",
      });

      const res = await buildApp().request("/api/projects/p1");

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        project: { id: string; name: string };
        articles: { slug: string; heading: string | null }[];
        sessions: { id: string; title: string | null; preview: string | null; status: string }[];
      };
      expect(body.project).toMatchObject({ id: "p1", name: "Research" });
      expect(body.articles).toEqual([
        expect.objectContaining({ slug: "corpus-doc", heading: "Corpus Doc" }),
      ]);
      expect(body.sessions).toEqual([
        expect.objectContaining({
          id: "s1",
          title: "Titled",
          preview: "hello there",
          status: "idle",
        }),
      ]);
    });

    it("404s an unknown id", async () => {
      const res = await buildApp().request("/api/projects/missing");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'project "missing" not found' });
    });
  });

  describe("PATCH /api/projects/:id", () => {
    const patch = (id: string, body: unknown) =>
      buildApp().request(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("renames the project and publishes project.updated", async () => {
      seedProject("p1", "Old Name");

      const res = await patch("p1", { name: "New Name" });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { project: { name: string } };
      expect(body.project.name).toBe("New Name");
      expect(events).toContainEqual({ type: "project.updated", id: "p1" });
    });

    it("404s an unknown id", async () => {
      const res = await patch("missing", { name: "New Name" });
      expect(res.status).toBe(404);
    });

    it("400s a blank name", async () => {
      seedProject("p1");
      const res = await patch("p1", { name: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("cascades the container and announces the project and its sessions", async () => {
      seedProject("p1");
      seedArticle("a1", "p1", "corpus-doc");
      createSession(env.db, MODEL, { id: "s1", projectId: "p1" });
      createSession(env.db, MODEL, {
        id: "c1",
        projectId: "p1",
        parentSessionId: "s1",
        parentToolCallId: "t1",
      });

      const res = await buildApp().request("/api/projects/p1", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(204);
      expect(events).toContainEqual({ type: "project.deleted", id: "p1" });
      expect(events).toContainEqual({ type: "session.deleted", id: "s1" });
      // The child was deleted with its parent, not announced separately.
      expect(events).not.toContainEqual({ type: "session.deleted", id: "c1" });
      expect(env.db.select().from(sessions).all()).toEqual([]);
      expect(env.db.select().from(articles).all()).toEqual([]);
      const list = await (await buildApp().request("/api/projects")).json();
      expect(list).toEqual({ projects: [] });
    });

    it("404s an unknown id", async () => {
      const res = await buildApp().request("/api/projects/missing", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/projects/:id/articles/:slug", () => {
    it("deletes the corpus article and publishes article.deleted with the project", async () => {
      seedProject("p1");
      seedArticle("a1", "p1", "corpus-doc");

      const res = await buildApp().request("/api/projects/p1/articles/corpus-doc", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(204);
      expect(events).toContainEqual({
        type: "article.deleted",
        projectId: "p1",
        slug: "corpus-doc",
      });
      expect(env.db.select().from(articles).all()).toEqual([]);
    });

    it("404s an unknown slug on an existing project", async () => {
      seedProject("p1");
      const res = await buildApp().request("/api/projects/p1/articles/missing", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });

    it("404s an unknown project", async () => {
      const res = await buildApp().request("/api/projects/missing/articles/corpus-doc", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/projects/:id/articles/:slug", () => {
    it("returns the full article with its derived heading", async () => {
      seedProject("p1");
      seedArticle("a1", "p1", "corpus-doc", "# Corpus Doc\n\nBody.");

      const res = await buildApp().request("/api/projects/p1/articles/corpus-doc");

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        id: "a1",
        projectId: "p1",
        slug: "corpus-doc",
        contentMd: "# Corpus Doc\n\nBody.",
        heading: "Corpus Doc",
      });
    });

    it("404s an unknown slug on an existing project", async () => {
      seedProject("p1");
      const res = await buildApp().request("/api/projects/p1/articles/missing");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'article "missing" not found on project "p1"' });
    });

    it("404s an unknown project", async () => {
      const res = await buildApp().request("/api/projects/missing/articles/corpus-doc");
      expect(res.status).toBe(404);
    });

    it("400s a slug outside the slug pattern", async () => {
      seedProject("p1");
      const res = await buildApp().request("/api/projects/p1/articles/Not%20A%20Slug");
      expect(res.status).toBe(400);
    });
  });
});
