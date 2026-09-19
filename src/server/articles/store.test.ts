import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { runs } from "../db/schema.ts";
import { createProject } from "../projects/store.ts";
import { createSession } from "../sessions/store.ts";
import {
  articleSummariesByOwner,
  createArticle,
  deleteArticle,
  getArticle,
  listArticleSummaries,
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
