import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { articles, sessions } from "../db/schema.ts";
import {
  appendMessage,
  createSession,
  deleteMessagesFrom,
  deleteSession,
  getSession,
  getSessionMessages,
  getSessionPreviews,
  setSessionStatus,
  updateMessage,
  updateSessionPersona,
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

  it("creates an idle session against the model with no persona by default", () => {
    const session = createSession(db, MODEL, { id: "s1" });

    expect(session.id).toBe("s1");
    expect(session.status).toBe("idle");
    expect(session.model).toBe(MODEL);
    expect(session.persona).toBeNull();
    expect(session.finishedAt).toBeNull();
    expect(getSession(db, "s1")?.id).toBe("s1");
  });

  it("attaches and detaches a persona", () => {
    createSession(db, MODEL, { id: "s1" });
    expect(getSession(db, "s1")?.persona).toBeNull();

    expect(updateSessionPersona(db, "s1", "code-reviewer").persona).toBe("code-reviewer");
    expect(getSession(db, "s1")?.persona).toBe("code-reviewer");

    expect(updateSessionPersona(db, "s1", null).persona).toBeNull();
    expect(getSession(db, "s1")?.persona).toBeNull();
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
