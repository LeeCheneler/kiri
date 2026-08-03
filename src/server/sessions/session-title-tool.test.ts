import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { KiriEvent } from "../events/index.ts";
import { sessionTitleTools } from "./session-title-tool.ts";
import { createSession, getSession } from "./store.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (t: ToolSet[string], input: unknown): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)(input, {
    toolCallId: "call-1",
    messages: [],
  } as ToolExecutionOptions);

describe("sessionTitleTools", () => {
  let dir: string;
  let db: KiriDb;
  let events: KiriEvent[];
  let tools: ToolSet;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-session-title-tool-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    createSession(db, MODEL, { id: "s1" });
    events = [];
    tools = sessionTitleTools(db, "s1", (event) => events.push(event));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("sets the session's title, trimmed, and publishes session.updated", async () => {
    const output = await run(tools.set_session_title, { title: "  Postgres upgrade plan  " });

    expect(output).toEqual({ title: "Postgres upgrade plan" });
    expect(getSession(db, "s1")?.title).toBe("Postgres upgrade plan");
    expect(events).toEqual([{ type: "session.updated", id: "s1", status: "idle" }]);
  });

  it("replaces an existing title on a later call", async () => {
    await run(tools.set_session_title, { title: "First title" });
    await run(tools.set_session_title, { title: "Second title" });

    expect(getSession(db, "s1")?.title).toBe("Second title");
  });

  it("rejects a whitespace-only title without touching the session", async () => {
    expect(run(tools.set_session_title, { title: "   " })).rejects.toThrow(
      "The title must contain visible characters",
    );
    expect(getSession(db, "s1")?.title).toBeNull();
    expect(events).toEqual([]);
  });

  it("rejects when the session no longer exists", async () => {
    const orphaned = sessionTitleTools(db, "missing", (event) => events.push(event));
    expect(run(orphaned.set_session_title, { title: "A title" })).rejects.toThrow(
      'session "missing" not found',
    );
    expect(events).toEqual([]);
  });
});
