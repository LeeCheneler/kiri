import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { runs, sessionArticles } from "../db/schema.ts";
import { createProject } from "../projects/store.ts";
import { createSession, deleteSession } from "../sessions/store.ts";
import {
  articleSummariesByOwner,
  countArticles,
  createArticle,
  deleteArticle,
  getArticle,
  listArticleSummaries,
  listSessionArticleActivity,
  sessionArticleOwner,
  updateArticle,
} from "./store.ts";

describe("articles store", () => {
  let dir: string;
  let db: KiriDb;
  const projectId = "project-1";
  const sessionId = "session-1";
  const runId = "run-1";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-articles-store-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    createProject(db, "Kiri", { id: projectId });
    createSession(db, "openai:gpt", { id: sessionId });
    db.insert(runs)
      .values({
        id: runId,
        workflowName: "news",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: { name: "news", steps: [] },
      })
      .run();
  });

  afterEach(() => {
    setSystemTime();
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("sessionArticleOwner", () => {
    it("is the session itself for a projectless session", () => {
      expect(sessionArticleOwner({ id: sessionId, projectId: null })).toEqual({ sessionId });
    });

    it("is the project's corpus for a session inside a project", () => {
      expect(sessionArticleOwner({ id: sessionId, projectId })).toEqual({ projectId });
    });
  });

  describe("createArticle", () => {
    it("humanises the slug into a name and stores the body without trailing whitespace", () => {
      const article = createArticle(
        db,
        { sessionId },
        { slug: "pr-digest", contentMd: "# Digest\n\n" },
      );

      expect(article).toMatchObject({
        sessionId,
        runId: null,
        projectId: null,
        slug: "pr-digest",
        name: "PR Digest",
        contentMd: "# Digest",
      });
    });

    it("keeps a given name", () => {
      const article = createArticle(
        db,
        { projectId },
        { slug: "notes", name: "Field notes", contentMd: "Body." },
      );

      expect(article.name).toBe("Field notes");
    });

    it("refuses a slug its owner already uses, while another owner may reuse it", () => {
      createArticle(db, { sessionId }, { slug: "notes", contentMd: "Body." });

      expect(() =>
        createArticle(db, { sessionId }, { slug: "notes", contentMd: "Again." }),
      ).toThrow();
      expect(createArticle(db, { runId }, { slug: "notes", contentMd: "Run body." }).runId).toBe(
        runId,
      );
    });
  });

  describe("session article activity", () => {
    it("keeps only each session's latest write, ordered by touch rather than creation", () => {
      createSession(db, "openai:gpt", { id: "session-2", projectId });
      setSystemTime(new Date(1000));
      const first = createArticle(
        db,
        { projectId },
        { slug: "first", contentMd: "# First" },
        sessionId,
      );
      setSystemTime(new Date(2000));
      createArticle(db, { projectId }, { slug: "second", contentMd: "# Second" }, sessionId);
      createArticle(db, { projectId }, { slug: "untouched", contentMd: "# Library" });
      setSystemTime(new Date(3000));
      updateArticle(db, first.id, { contentMd: "# Sibling edit" }, "session-2");
      setSystemTime(new Date(4000));
      updateArticle(db, first.id, { name: "Revised", contentMd: "# Revised" }, sessionId);

      expect(listSessionArticleActivity(db, sessionId)).toEqual([
        {
          slug: "first",
          name: "Revised",
          heading: "Revised",
          createdAt: new Date(1000),
          lastTouchedAt: new Date(4000),
        },
        {
          slug: "second",
          name: "Second",
          heading: "Second",
          createdAt: new Date(2000),
          lastTouchedAt: new Date(2000),
        },
      ]);
      expect(listSessionArticleActivity(db, "session-2")).toEqual([
        {
          slug: "first",
          name: "Revised",
          heading: "Revised",
          createdAt: new Date(1000),
          lastTouchedAt: new Date(3000),
        },
      ]);
      expect(db.select().from(sessionArticles).all()).toHaveLength(3);
      expect(getArticle(db, { projectId }, "first")).toMatchObject({
        projectId,
        sessionId: null,
        runId: null,
      });
    });

    it("breaks equal touch times deterministically by article id", () => {
      setSystemTime(new Date(1000));
      const first = createArticle(
        db,
        { sessionId },
        { slug: "first", contentMd: "First" },
        sessionId,
      );
      const second = createArticle(
        db,
        { sessionId },
        { slug: "second", contentMd: "Second" },
        sessionId,
      );
      const expected = [first, second].sort((a, b) => b.id.localeCompare(a.id)).map((a) => a.slug);
      expect(listSessionArticleActivity(db, sessionId).map((a) => a.slug)).toEqual(expected);
    });

    it("rolls back article creation and updates when recording their writer fails", () => {
      expect(() =>
        createArticle(db, { projectId }, { slug: "failed", contentMd: "# Failed" }, "missing"),
      ).toThrow();
      expect(getArticle(db, { projectId }, "failed")).toBeUndefined();
      const article = createArticle(
        db,
        { projectId },
        { slug: "kept", contentMd: "# Original" },
        sessionId,
      );
      const activity = listSessionArticleActivity(db, sessionId);

      expect(() =>
        updateArticle(db, article.id, { name: "Failed", contentMd: "# Failed" }, "missing"),
      ).toThrow();
      expect(getArticle(db, { projectId }, "kept")).toEqual(article);
      expect(listSessionArticleActivity(db, sessionId)).toEqual(activity);
      expect(
        db.$client.query("SELECT 1 FROM search_fts WHERE search_fts MATCH 'failed'").all(),
      ).toEqual([]);
    });

    it("deletes a session's links and standalone articles but preserves the shared corpus and other writers", () => {
      createSession(db, "openai:gpt", { id: "session-2", projectId });
      createArticle(db, { sessionId }, { slug: "standalone", contentMd: "Owned" }, sessionId);
      const shared = createArticle(
        db,
        { projectId },
        { slug: "shared", contentMd: "Shared" },
        sessionId,
      );
      updateArticle(db, shared.id, { contentMd: "Shared edit" }, "session-2");

      deleteSession(db, sessionId);

      expect(listSessionArticleActivity(db, sessionId)).toEqual([]);
      expect(getArticle(db, { sessionId }, "standalone")).toBeUndefined();
      expect(getArticle(db, { projectId }, "shared")?.contentMd).toBe("Shared edit");
      expect(listSessionArticleActivity(db, "session-2").map((a) => a.slug)).toEqual(["shared"]);
      expect(db.select().from(sessionArticles).all()).toHaveLength(1);
    });

    it("does not record duplicate creates or missing updates", () => {
      const article = createArticle(
        db,
        { projectId },
        { slug: "notes", contentMd: "Notes" },
        sessionId,
      );
      const activity = listSessionArticleActivity(db, sessionId);
      expect(() =>
        createArticle(db, { projectId }, { slug: "notes", contentMd: "Again" }, sessionId),
      ).toThrow();
      expect(() => updateArticle(db, "missing", { contentMd: "Missing" }, sessionId)).toThrow(
        "not found",
      );
      expect(listSessionArticleActivity(db, sessionId)).toEqual(activity);
      deleteArticle(db, article.id);
      expect(db.select().from(sessionArticles).all()).toEqual([]);
    });
  });

  describe("getArticle", () => {
    it("addresses one owner only", () => {
      createArticle(db, { projectId }, { slug: "notes", contentMd: "Project body." });

      expect(getArticle(db, { projectId }, "notes")?.contentMd).toBe("Project body.");
      expect(getArticle(db, { sessionId }, "notes")).toBeUndefined();
      expect(getArticle(db, { runId }, "notes")).toBeUndefined();
    });
  });

  describe("updateArticle", () => {
    it("rewrites the body alone, trimmed, leaving the name", () => {
      const article = createArticle(
        db,
        { sessionId },
        { slug: "notes", name: "Notes", contentMd: "Old." },
      );

      const updated = updateArticle(db, article.id, { contentMd: "New.\n\n" });

      expect(updated).toMatchObject({ name: "Notes", contentMd: "New." });
    });

    it("keeps the listed heading in step with each rewrite, including one that drops it", () => {
      const article = createArticle(db, { sessionId }, { slug: "notes", contentMd: "# First" });
      const listed = () => listArticleSummaries(db, { sessionId }).map((entry) => entry.heading);

      updateArticle(db, article.id, { contentMd: "# Second\n\nBody." });
      expect(listed()).toEqual(["Second"]);

      updateArticle(db, article.id, { contentMd: "Body alone." });
      expect(listed()).toEqual([null]);
    });

    it("renames alongside the rewrite when a name is given", () => {
      const article = createArticle(db, { sessionId }, { slug: "notes", contentMd: "Old." });

      const updated = updateArticle(db, article.id, { name: "Renamed", contentMd: "New." });

      expect(updated).toMatchObject({ name: "Renamed", contentMd: "New." });
    });
  });

  describe("deleteArticle", () => {
    it("removes the one article", () => {
      const article = createArticle(db, { sessionId }, { slug: "stale", contentMd: "Body." });
      createArticle(db, { sessionId }, { slug: "kept", contentMd: "Body." });

      deleteArticle(db, article.id);

      expect(listArticleSummaries(db, { sessionId }).map((a) => a.slug)).toEqual(["kept"]);
    });
  });

  describe("listArticleSummaries", () => {
    beforeEach(async () => {
      createArticle(db, { projectId }, { slug: "first", contentMd: "# First heading\n\nBody." });
      await Bun.sleep(2);
      createArticle(db, { projectId }, { slug: "second", contentMd: "No heading here." });
      createArticle(db, { sessionId }, { slug: "elsewhere", contentMd: "Body." });
    });

    it("lists one owner's entries oldest first, each with its body's heading", () => {
      expect(listArticleSummaries(db, { projectId })).toMatchObject([
        { slug: "first", name: "First", heading: "First heading" },
        { slug: "second", name: "Second", heading: null },
      ]);
    });

    it("lists newest first on request", () => {
      const slugs = listArticleSummaries(db, { projectId }, { newestFirst: true }).map(
        (a) => a.slug,
      );

      expect(slugs).toEqual(["second", "first"]);
    });

    it("cuts the list to a limit and counts the owner's articles apart from it", () => {
      const newest = listArticleSummaries(db, { projectId }, { newestFirst: true, limit: 1 });

      expect(newest.map((a) => a.slug)).toEqual(["second"]);
      expect(countArticles(db, { projectId })).toBe(2);
      expect(countArticles(db, { sessionId })).toBe(1);
    });
  });

  describe("articleSummariesByOwner", () => {
    it("groups many owners' entries in one pass, leaving out owners with none", () => {
      createSession(db, "openai:gpt", { id: "session-2" });
      createArticle(db, { sessionId }, { slug: "one", contentMd: "# One" });
      createArticle(db, { runId }, { slug: "from-run", contentMd: "Body." });

      const bySession = articleSummariesByOwner(db, "sessionId", [sessionId, "session-2"]);

      expect([...bySession.keys()]).toEqual([sessionId]);
      expect(bySession.get(sessionId)).toMatchObject([{ slug: "one", heading: "One" }]);
      expect(articleSummariesByOwner(db, "runId", [runId]).get(runId)).toMatchObject([
        { slug: "from-run" },
      ]);
    });

    it("skips the query for an empty page", () => {
      expect(articleSummariesByOwner(db, "sessionId", []).size).toBe(0);
    });
  });
});
