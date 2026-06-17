import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { sessions } from "../db/schema.ts";
import {
  addTurnUsage,
  appendMessage,
  createSession,
  deleteSession,
  getSession,
  getSessionMessages,
  getSessionPreviews,
  setSessionStatus,
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

  it("creates an idle session snapshotting the agent config", () => {
    const session = createSession(db, MODEL, { id: "s1" });

    expect(session.id).toBe("s1");
    expect(session.status).toBe("idle");
    expect(session.model).toBe(MODEL);
    expect(session.totalTokens).toBe(0);
    expect(session.finishedAt).toBeNull();
    expect(getSession(db, "s1")?.id).toBe("s1");
  });

  it("appends messages at incrementing indices in order", () => {
    createSession(db, MODEL, { id: "s1" });

    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "Hi" }] });
    appendMessage(db, "s1", {
      role: "assistant",
      parts: [{ type: "text", text: "Hello" }],
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
    });

    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(rows[0]?.parts).toEqual([{ type: "text", text: "Hi" }]);
    expect(rows[0]?.usage).toBeNull();
    expect(rows[1]?.usage).toEqual({ inputTokens: 3, outputTokens: 5, totalTokens: 8 });
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

  it("accumulates turn usage onto the running totals, ignoring omitted counts", () => {
    createSession(db, MODEL, { id: "s1" });

    addTurnUsage(db, "s1", { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    addTurnUsage(db, "s1", { inputTokens: 5, totalTokens: 5 });

    const session = getSession(db, "s1");
    expect(session?.inputTokens).toBe(15);
    expect(session?.outputTokens).toBe(20);
    expect(session?.totalTokens).toBe(35);
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

  it("deletes a session with its messages, leaving other sessions intact", () => {
    createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "Hi" }] });
    appendMessage(db, "s1", { role: "assistant", parts: [{ type: "text", text: "Hello" }] });
    createSession(db, MODEL, { id: "s2" });
    appendMessage(db, "s2", { role: "user", parts: [{ type: "text", text: "Keep me" }] });

    deleteSession(db, "s1");

    expect(getSession(db, "s1")).toBeUndefined();
    expect(getSessionMessages(db, "s1")).toHaveLength(0);
    expect(getSession(db, "s2")?.id).toBe("s2");
    expect(getSessionMessages(db, "s2")).toHaveLength(1);
  });

  it("is a no-op deleting a session that does not exist", () => {
    createSession(db, MODEL, { id: "s1" });
    deleteSession(db, "ghost");
    expect(getSession(db, "s1")?.id).toBe("s1");
  });
});
