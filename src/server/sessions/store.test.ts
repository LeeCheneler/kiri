import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { articles, projects, sessions } from "../db/schema.ts";
import {
  appendMessage,
  createSession,
  deleteMessagesFrom,
  deleteSession,
  findChildByToolCall,
  getSession,
  getSessionLabels,
  getSessionLastActivity,
  getSessionMessages,
  getSessionPreviews,
  getSessionsWithWaitingChildren,
  setSessionStatus,
  updateMessage,
  updateSessionCwd,
  updateSessionEffort,
  updateSessionImageModel,
  updateSessionTitle,
} from "./store.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

describe("sessions store", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-sessions-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates an idle top-level session against the model by default", () => {
    const session = createSession(db, MODEL, { id: "s1" });

    expect(session.id).toBe("s1");
    expect(session.status).toBe("idle");
    expect(session.model).toBe(MODEL);
    expect(session.finishedAt).toBeNull();
    expect(session.parentSessionId).toBeNull();
    expect(session.parentToolCallId).toBeNull();
    expect(session.imageModel).toBeNull();
    expect(session.effort).toBe("medium");
    expect(session.projectId).toBeNull();
    expect(getSession(db, "s1")?.id).toBe("s1");
  });

  it("creates a session within a project when one is given", () => {
    db.insert(projects).values({ id: "p1", name: "Research", createdAt: new Date() }).run();

    const session = createSession(db, MODEL, { id: "s1", projectId: "p1" });

    expect(session.projectId).toBe("p1");
  });

  it("creates a session with an image model when one is given", () => {
    const session = createSession(db, MODEL, { id: "s1", imageModel: "openai:gpt-image" });
    expect(session.imageModel).toBe("openai:gpt-image");
  });

  it("creates a session at a stated effort level", () => {
    const session = createSession(db, MODEL, { id: "s1", effort: "high" });
    expect(session.effort).toBe("high");
  });

  it("creates a session with a title when one is given", () => {
    expect(createSession(db, MODEL, { id: "s1" }).title).toBeNull();
    expect(createSession(db, MODEL, { id: "s2", title: "Pelican census" }).title).toBe(
      "Pelican census",
    );
  });

  it("creates a session with a working directory when one is given", () => {
    expect(createSession(db, MODEL, { id: "s1" }).cwd).toBeNull();
    expect(createSession(db, MODEL, { id: "s2", cwd: "/srv/notes" }).cwd).toBe("/srv/notes");
  });

  it("sets and clears the working directory", () => {
    createSession(db, MODEL, { id: "s1" });

    expect(updateSessionCwd(db, "s1", "/srv/notes/inbox").cwd).toBe("/srv/notes/inbox");
    expect(getSession(db, "s1")?.cwd).toBe("/srv/notes/inbox");

    expect(updateSessionCwd(db, "s1", null).cwd).toBeNull();
    expect(getSession(db, "s1")?.cwd).toBeNull();
  });

  it("sets the effort level", () => {
    createSession(db, MODEL, { id: "s1" });

    expect(updateSessionEffort(db, "s1", "max").effort).toBe("max");
    expect(getSession(db, "s1")?.effort).toBe("max");
  });

  it("creates a child session carrying its parent and spawning tool call", () => {
    createSession(db, MODEL, { id: "parent" });
    const child = createSession(db, MODEL, {
      id: "child",
      parentSessionId: "parent",
      parentToolCallId: "call_1",
    });

    expect(child.parentSessionId).toBe("parent");
    expect(child.parentToolCallId).toBe("call_1");
    expect(getSession(db, "child")?.parentSessionId).toBe("parent");
  });

  it("finds a child by its parent and spawning tool call", () => {
    createSession(db, MODEL, { id: "parent" });
    createSession(db, MODEL, {
      id: "child",
      parentSessionId: "parent",
      parentToolCallId: "call_1",
    });

    expect(findChildByToolCall(db, "parent", "call_1")?.id).toBe("child");
    // A different tool call, or a different parent, has no child.
    expect(findChildByToolCall(db, "parent", "call_2")).toBeUndefined();
    expect(findChildByToolCall(db, "other", "call_1")).toBeUndefined();
  });

  it("sets and clears the title", () => {
    createSession(db, MODEL, { id: "s1" });
    expect(getSession(db, "s1")?.title).toBeNull();

    expect(updateSessionTitle(db, "s1", "Postgres upgrade plan").title).toBe(
      "Postgres upgrade plan",
    );
    expect(getSession(db, "s1")?.title).toBe("Postgres upgrade plan");

    expect(updateSessionTitle(db, "s1", null).title).toBeNull();
    expect(getSession(db, "s1")?.title).toBeNull();
  });

  it("sets and clears the image model", () => {
    createSession(db, MODEL, { id: "s1" });
    expect(getSession(db, "s1")?.imageModel).toBeNull();

    expect(updateSessionImageModel(db, "s1", "openrouter:gemini-image").imageModel).toBe(
      "openrouter:gemini-image",
    );
    expect(getSession(db, "s1")?.imageModel).toBe("openrouter:gemini-image");

    expect(updateSessionImageModel(db, "s1", null).imageModel).toBeNull();
    expect(getSession(db, "s1")?.imageModel).toBeNull();
  });

  it("appends messages at incrementing indices in order", () => {
    createSession(db, MODEL, { id: "s1" });

    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "Hi" }] });
    appendMessage(db, "s1", {
      role: "assistant",
      parts: [{ type: "text", text: "Hello" }],
      contextTokens: 8,
    });

    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(rows[0]?.parts).toEqual([{ type: "text", text: "Hi" }]);
    expect(rows[0]?.contextTokens).toBeNull();
    expect(rows[1]?.contextTokens).toBe(8);
  });

  it("patches parts only, then records the resumed turn's footprint", () => {
    createSession(db, MODEL, { id: "s1" });
    const msg = appendMessage(db, "s1", {
      role: "assistant",
      parts: [{ type: "text", text: "paused" }],
      contextTokens: 8,
    });

    // A parts-only patch (the approval verdicts) leaves the footprint untouched.
    updateMessage(db, "s1", msg.id, { parts: [{ type: "text", text: "verdicts" }] });
    expect(getSessionMessages(db, "s1")[0]?.contextTokens).toBe(8);

    // The streamed continuation replaces the footprint with the resumed turn's.
    updateMessage(db, "s1", msg.id, {
      parts: [{ type: "text", text: "resumed" }],
      contextTokens: 20,
    });

    const row = getSessionMessages(db, "s1")[0];
    expect(row?.parts).toEqual([{ type: "text", text: "resumed" }]);
    expect(row?.contextTokens).toBe(20);
  });

  it("previews each session's first user message, collapsed to one capped line", () => {
    createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", {
      role: "user",
      parts: [{ type: "text", text: `Refactor the\nauth   middleware ${"x".repeat(200)}` }],
    });
    appendMessage(db, "s1", { role: "assistant", parts: [{ type: "text", text: "On it" }] });
    // A later user turn must not displace the first as the preview.
    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "And add tests" }] });
    createSession(db, MODEL, { id: "s2" }); // no messages yet

    expect(getSessionPreviews(db, []).size).toBe(0);

    const previews = getSessionPreviews(db, ["s1", "s2"]);
    const s1 = previews.get("s1") ?? "";
    // Capped to one line and marked truncated with a trailing ellipsis.
    expect(s1.startsWith("Refactor the auth middleware ")).toBe(true);
    expect(s1.endsWith("…")).toBe(true);
    expect(s1.length).toBeLessThanOrEqual(101);
    expect(previews.has("s2")).toBe(false);
  });

  it("skips non-text parts and omits a first message that carries no text", () => {
    createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", {
      role: "user",
      parts: [
        { type: "text", text: "Ship it" },
        { type: "reasoning", text: "weighing options" },
      ],
    });
    createSession(db, MODEL, { id: "s2" });
    appendMessage(db, "s2", { role: "user", parts: [{ type: "reasoning", text: "no prose" }] });

    const previews = getSessionPreviews(db, ["s1", "s2"]);
    expect(previews.get("s1")).toBe("Ship it");
    expect(previews.has("s2")).toBe(false);
  });

  it("labels sessions by title, else opening message, else short id", () => {
    createSession(db, MODEL, { id: "titled-0000-0000", title: "Corpus sweep" });
    createSession(db, MODEL, { id: "spoken-0000-0000" });
    appendMessage(db, "spoken-0000-0000", {
      role: "user",
      parts: [{ type: "text", text: "Sweep the corpus" }],
    });
    createSession(db, MODEL, { id: "silent-0000-0000" });

    expect(getSessionLabels(db, []).size).toBe(0);

    const labels = getSessionLabels(db, [
      "titled-0000-0000",
      "spoken-0000-0000",
      "silent-0000-0000",
      "gone",
    ]);
    expect(labels.get("titled-0000-0000")).toBe("Corpus sweep");
    expect(labels.get("spoken-0000-0000")).toBe("Sweep the corpus");
    // Never left unnamed: the short id stands in when there is nothing else.
    expect(labels.get("silent-0000-0000")).toBe("silent-0");
    expect(labels.has("gone")).toBe(false);
  });

  it("reports each session's last activity as its newest message's timestamp", () => {
    createSession(db, MODEL, { id: "s1" });
    appendMessage(
      db,
      "s1",
      { role: "user", parts: [{ type: "text", text: "Hi" }] },
      { createdAt: new Date(1000) },
    );
    appendMessage(
      db,
      "s1",
      { role: "assistant", parts: [{ type: "text", text: "Hello" }] },
      { createdAt: new Date(3000) },
    );
    createSession(db, MODEL, { id: "s2" });
    appendMessage(
      db,
      "s2",
      { role: "user", parts: [{ type: "text", text: "Later" }] },
      { createdAt: new Date(2000) },
    );
    createSession(db, MODEL, { id: "s3" }); // no messages yet

    expect(getSessionLastActivity(db, []).size).toBe(0);

    const activity = getSessionLastActivity(db, ["s1", "s2", "s3"]);
    expect(activity.get("s1")).toEqual(new Date(3000));
    expect(activity.get("s2")).toEqual(new Date(2000));
    expect(activity.has("s3")).toBe(false);
  });

  it("finds the sessions with a delegated child paused waiting on approval", () => {
    createSession(db, MODEL, { id: "s1" });
    createSession(db, MODEL, { id: "c1", parentSessionId: "s1", parentToolCallId: "call_1" });
    setSessionStatus(db, "c1", "waiting");
    // An idle child never marks its parent.
    createSession(db, MODEL, { id: "s2" });
    createSession(db, MODEL, { id: "c2", parentSessionId: "s2", parentToolCallId: "call_2" });
    // A session waiting on its own turn is not a waiting child.
    createSession(db, MODEL, { id: "s3" });
    setSessionStatus(db, "s3", "waiting");

    expect(getSessionsWithWaitingChildren(db, []).size).toBe(0);

    const waiting = getSessionsWithWaitingChildren(db, ["s1", "s2", "s3"]);
    expect(waiting.has("s1")).toBe(true);
    expect(waiting.has("s2")).toBe(false);
    expect(waiting.has("s3")).toBe(false);
  });

  it("moves a session to a terminal status with error and finishedAt", () => {
    createSession(db, MODEL, { id: "s1" });
    const finishedAt = new Date(1_700_000_000_000);

    setSessionStatus(db, "s1", "failed", { error: { message: "boom" }, finishedAt });

    const session = db.select().from(sessions).where(eq(sessions.id, "s1")).get();
    expect(session?.status).toBe("failed");
    expect(session?.error).toEqual({ message: "boom" });
    expect(session?.finishedAt).toEqual(finishedAt);
  });

  it("leaves error and finishedAt untouched when only the status changes", () => {
    createSession(db, MODEL, { id: "s1" });
    setSessionStatus(db, "s1", "running");
    setSessionStatus(db, "s1", "idle");

    const session = getSession(db, "s1");
    expect(session?.status).toBe("idle");
    expect(session?.error).toBeNull();
    expect(session?.finishedAt).toBeNull();
  });

  it("deletes a session with its messages and articles, leaving other sessions intact", () => {
    const insertArticle = (sessionId: string, slug: string) =>
      db
        .insert(articles)
        .values({
          id: crypto.randomUUID(),
          sessionId,
          slug,
          name: "Notes",
          contentMd: "# Notes",
          createdAt: new Date(),
        })
        .run();
    createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "Hi" }] });
    appendMessage(db, "s1", { role: "assistant", parts: [{ type: "text", text: "Hello" }] });
    insertArticle("s1", "notes");
    createSession(db, MODEL, { id: "s2" });
    appendMessage(db, "s2", { role: "user", parts: [{ type: "text", text: "Keep me" }] });
    insertArticle("s2", "notes");

    deleteSession(db, "s1");

    expect(getSession(db, "s1")).toBeUndefined();
    expect(getSessionMessages(db, "s1")).toHaveLength(0);
    expect(db.select().from(articles).where(eq(articles.sessionId, "s1")).all()).toHaveLength(0);
    expect(getSession(db, "s2")?.id).toBe("s2");
    expect(getSessionMessages(db, "s2")).toHaveLength(1);
    expect(db.select().from(articles).where(eq(articles.sessionId, "s2")).all()).toHaveLength(1);
  });

  it("deletes a session's children and their messages along with it", () => {
    createSession(db, MODEL, { id: "parent" });
    appendMessage(db, "parent", { role: "user", parts: [{ type: "text", text: "Delegate" }] });
    createSession(db, MODEL, {
      id: "child",
      parentSessionId: "parent",
      parentToolCallId: "call_1",
    });
    appendMessage(db, "child", { role: "user", parts: [{ type: "text", text: "Task" }] });
    createSession(db, MODEL, { id: "other" });

    deleteSession(db, "parent");

    expect(getSession(db, "parent")).toBeUndefined();
    expect(getSession(db, "child")).toBeUndefined();
    expect(getSessionMessages(db, "child")).toHaveLength(0);
    expect(getSession(db, "other")?.id).toBe("other");
  });

  it("is a no-op deleting a session that does not exist", () => {
    createSession(db, MODEL, { id: "s1" });
    deleteSession(db, "ghost");
    expect(getSession(db, "s1")?.id).toBe("s1");
  });

  it("truncates from a message, dropping it and every later message", () => {
    createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "Q1" }] });
    appendMessage(db, "s1", {
      role: "assistant",
      parts: [{ type: "text", text: "A1" }],
      contextTokens: 8,
    });
    const second = appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "Q2" }] });
    appendMessage(db, "s1", {
      role: "assistant",
      parts: [{ type: "text", text: "A2" }],
      contextTokens: 24,
    });
    // A second session's messages must be untouched.
    createSession(db, MODEL, { id: "s2" });
    appendMessage(db, "s2", { role: "user", parts: [{ type: "text", text: "Keep me" }] });

    expect(deleteMessagesFrom(db, "s1", second.id)).toBe(true);

    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(getSessionMessages(db, "s2")).toHaveLength(1);
  });

  it("clears the transcript when truncating from the first message", () => {
    createSession(db, MODEL, { id: "s1" });
    const first = appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "Q1" }] });
    appendMessage(db, "s1", {
      role: "assistant",
      parts: [{ type: "text", text: "A1" }],
      contextTokens: 8,
    });

    expect(deleteMessagesFrom(db, "s1", first.id)).toBe(true);

    expect(getSessionMessages(db, "s1")).toHaveLength(0);
  });

  it("is a no-op truncating from a message that does not exist", () => {
    createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "Q1" }] });

    expect(deleteMessagesFrom(db, "s1", "ghost")).toBe(false);

    expect(getSessionMessages(db, "s1")).toHaveLength(1);
  });
});
