import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { KiriEvent } from "../events/index.ts";
import { SESSION_TITLE_MAX_LENGTH, generateSessionTitle } from "./session-title.ts";
import { createSession, getSession, updateSessionTitle } from "./store.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// An LlmClients stand-in for the one method title generation uses, capturing
// each call and answering with a scripted result.
const fakeLlm = (result: Promise<{ text: string; usage: object }>) => {
  const calls: { model: string; prompt: string }[] = [];
  return {
    calls,
    llmClients: {
      generateText: (options: { model: string; prompt: string }) => {
        calls.push({ model: options.model, prompt: options.prompt });
        return result;
      },
    },
  };
};

describe("generateSessionTitle", () => {
  let dir: string;
  let db: KiriDb;
  let events: KiriEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-session-title-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    createSession(db, MODEL, { id: "s1" });
    events = [];
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const generate = (opts: {
    llmClients: { generateText: (o: { model: string; prompt: string }) => Promise<unknown> };
    userText?: string;
    sessionId?: string;
  }) =>
    generateSessionTitle({
      db,
      llmClients: opts.llmClients as Parameters<typeof generateSessionTitle>[0]["llmClients"],
      sessionId: opts.sessionId ?? "s1",
      userText: opts.userText ?? "How do I upgrade Postgres 16 to 17?",
      model: "local:tiny",
      publish: (event) => events.push(event),
    });

  it("titles the session from the generation and publishes session.updated", async () => {
    const { calls, llmClients } = fakeLlm(
      Promise.resolve({ text: "  Postgres 17 upgrade  \n", usage: {} }),
    );
    await generate({ llmClients });

    expect(getSession(db, "s1")?.title).toBe("Postgres 17 upgrade");
    expect(events).toEqual([{ type: "session.updated", id: "s1", status: "idle" }]);
    expect(calls).toEqual([
      { model: "local:tiny", prompt: expect.stringContaining("How do I upgrade Postgres 16") },
    ]);
  });

  it("keeps only the first line and strips wrapping quotes", async () => {
    const { llmClients } = fakeLlm(
      Promise.resolve({ text: '"Postgres 17 upgrade"\nHere is why I chose it…', usage: {} }),
    );
    await generate({ llmClients });

    expect(getSession(db, "s1")?.title).toBe("Postgres 17 upgrade");
  });

  it("clamps an overlong generation to the title length cap", async () => {
    const { llmClients } = fakeLlm(
      Promise.resolve({ text: "t".repeat(SESSION_TITLE_MAX_LENGTH * 2), usage: {} }),
    );
    await generate({ llmClients });

    expect(getSession(db, "s1")?.title).toHaveLength(SESSION_TITLE_MAX_LENGTH);
  });

  it("truncates an oversized opening message before sending it", async () => {
    const { calls, llmClients } = fakeLlm(Promise.resolve({ text: "A title", usage: {} }));
    await generate({ llmClients, userText: "x".repeat(10_000) });

    expect(calls[0]?.prompt.length).toBeLessThan(3000);
  });

  it("leaves the session untitled on a whitespace-only generation", async () => {
    const { llmClients } = fakeLlm(Promise.resolve({ text: "   \n  ", usage: {} }));
    await generate({ llmClients });

    expect(getSession(db, "s1")?.title).toBeNull();
    expect(events).toEqual([]);
  });

  it("never overwrites a title set while the generation was in flight", async () => {
    let respond!: (result: { text: string; usage: object }) => void;
    const { llmClients } = fakeLlm(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    const pending = generate({ llmClients });
    updateSessionTitle(db, "s1", "User's own name");
    respond({ text: "Generated title", usage: {} });
    await pending;

    expect(getSession(db, "s1")?.title).toBe("User's own name");
    expect(events).toEqual([]);
  });

  it("does nothing when the session was deleted mid-flight", async () => {
    const { llmClients } = fakeLlm(Promise.resolve({ text: "A title", usage: {} }));
    await generate({ llmClients, sessionId: "missing" });

    expect(events).toEqual([]);
  });

  it("swallows a failed generation with a warning, leaving the session untitled", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const { llmClients } = fakeLlm(Promise.reject(new Error("provider down")));
    await generate({ llmClients });

    expect(getSession(db, "s1")?.title).toBeNull();
    expect(events).toEqual([]);
    expect(warn.mock.calls[0]?.[0]).toContain("provider down");
    warn.mockRestore();
  });

  it("stringifies a non-Error failure in the warning", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const { llmClients } = fakeLlm(Promise.reject("boom"));
    await generate({ llmClients });

    expect(warn.mock.calls[0]?.[0]).toContain("boom");
    warn.mockRestore();
  });
});
