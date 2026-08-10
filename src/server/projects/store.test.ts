import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { articles, messages } from "../db/schema.ts";
import { appendMessage, createSession, getSession } from "../sessions/store.ts";
import { createProject, deleteProject, getProject, listProjects, updateProject } from "./store.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

describe("projects store", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-projects-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a project and reads it back", () => {
    const project = createProject(db, "Research", { id: "p1" });

    expect(project.id).toBe("p1");
    expect(project.name).toBe("Research");
    expect(project.createdAt).toBeInstanceOf(Date);
    expect(getProject(db, "p1")?.name).toBe("Research");
  });

  it("generates an id when none is given", () => {
    const project = createProject(db, "Research");

    expect(project.id).not.toBe("");
    expect(getProject(db, project.id)?.id).toBe(project.id);
  });

  it("returns undefined for an absent project", () => {
    expect(getProject(db, "missing")).toBeUndefined();
  });

  it("lists projects newest first", () => {
    createProject(db, "Older", { id: "p1", createdAt: new Date(1000) });
    createProject(db, "Newer", { id: "p2", createdAt: new Date(2000) });

    expect(listProjects(db).map((project) => project.id)).toEqual(["p2", "p1"]);
  });

  it("renames a project", () => {
    createProject(db, "Old Name", { id: "p1" });

    const updated = updateProject(db, "p1", { name: "New Name" });

    expect(updated.name).toBe("New Name");
    expect(getProject(db, "p1")?.name).toBe("New Name");
  });

  it("creates a project with no instructions", () => {
    expect(createProject(db, "Research", { id: "p1" }).instructions).toBeNull();
  });

  it("saves trimmed instructions without touching the name", () => {
    createProject(db, "Research", { id: "p1" });

    const updated = updateProject(db, "p1", { instructions: "  Answer in British English.\n" });

    expect(updated.name).toBe("Research");
    expect(updated.instructions).toBe("Answer in British English.");
  });

  it("stores blank instructions as none", () => {
    createProject(db, "Research", { id: "p1" });
    updateProject(db, "p1", { instructions: "Something" });

    expect(updateProject(db, "p1", { instructions: "   \n" }).instructions).toBeNull();
  });

  it("leaves fields the patch omits untouched", () => {
    createProject(db, "Research", { id: "p1" });
    updateProject(db, "p1", { instructions: "Standing context." });

    const updated = updateProject(db, "p1", {});

    expect(updated.name).toBe("Research");
    expect(updated.instructions).toBe("Standing context.");
  });

  it("deletes a project with no sessions or articles", () => {
    createProject(db, "Empty", { id: "p1" });

    deleteProject(db, "p1");

    expect(getProject(db, "p1")).toBeUndefined();
  });

  it("deletes the project's articles, sessions, their children, and everything they own", () => {
    createProject(db, "Research", { id: "p1" });
    createSession(db, MODEL, { id: "s1", projectId: "p1" });
    createSession(db, MODEL, { id: "c1", parentSessionId: "s1", parentToolCallId: "t1" });
    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "hello" }] });
    db.insert(articles)
      .values([
        {
          id: "a1",
          projectId: "p1",
          slug: "corpus-doc",
          name: "Corpus Doc",
          contentMd: "# Corpus",
          createdAt: new Date(),
        },
        {
          id: "a2",
          sessionId: "c1",
          slug: "child-doc",
          name: "Child Doc",
          contentMd: "# Child",
          createdAt: new Date(),
        },
      ])
      .run();

    deleteProject(db, "p1");

    expect(getProject(db, "p1")).toBeUndefined();
    expect(getSession(db, "s1")).toBeUndefined();
    expect(getSession(db, "c1")).toBeUndefined();
    expect(db.select().from(articles).all()).toEqual([]);
    expect(db.select().from(messages).all()).toEqual([]);
  });

  it("leaves other projects and projectless sessions untouched", () => {
    createProject(db, "Doomed", { id: "p1" });
    createProject(db, "Kept", { id: "p2" });
    createSession(db, MODEL, { id: "s1", projectId: "p1" });
    createSession(db, MODEL, { id: "s2", projectId: "p2" });
    createSession(db, MODEL, { id: "s3" });
    db.insert(articles)
      .values({
        id: "a1",
        projectId: "p2",
        slug: "kept-doc",
        name: "Kept Doc",
        contentMd: "# Kept",
        createdAt: new Date(),
      })
      .run();

    deleteProject(db, "p1");

    expect(getProject(db, "p2")?.name).toBe("Kept");
    expect(getSession(db, "s1")).toBeUndefined();
    expect(getSession(db, "s2")?.id).toBe("s2");
    expect(getSession(db, "s3")?.id).toBe("s3");
    expect(db.select().from(articles).where(eq(articles.projectId, "p2")).all()).toHaveLength(1);
  });

  it("removes nothing when deleting an absent project", () => {
    createProject(db, "Kept", { id: "p1" });

    deleteProject(db, "missing");

    expect(listProjects(db)).toHaveLength(1);
  });

  it("enforces one owner per article", () => {
    createProject(db, "Research", { id: "p1" });
    createSession(db, MODEL, { id: "s1", projectId: "p1" });

    expect(() =>
      db
        .insert(articles)
        .values({
          id: "a1",
          projectId: "p1",
          sessionId: "s1",
          slug: "two-owners",
          name: "Two Owners",
          contentMd: "# Nope",
          createdAt: new Date(),
        })
        .run(),
    ).toThrow();
  });

  it("enforces slug uniqueness within a project", () => {
    createProject(db, "Research", { id: "p1" });
    createProject(db, "Other", { id: "p2" });
    const article = {
      slug: "corpus-doc",
      name: "Corpus Doc",
      contentMd: "# Corpus",
      createdAt: new Date(),
    };
    db.insert(articles)
      .values({ ...article, id: "a1", projectId: "p1" })
      .run();
    db.insert(articles)
      .values({ ...article, id: "a2", projectId: "p2" })
      .run();

    expect(() =>
      db
        .insert(articles)
        .values({ ...article, id: "a3", projectId: "p1" })
        .run(),
    ).toThrow();
  });
});
