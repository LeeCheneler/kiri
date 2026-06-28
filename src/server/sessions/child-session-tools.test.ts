import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessage } from "ai";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { childSessionGuidance, childSessionTools } from "./child-session-tools.ts";
import { INVESTIGATE_CHILD_GUIDANCE, INVESTIGATE_TOOL_NAME } from "./investigate-tool.ts";
import { type NewMessage, type Session, appendMessage, createSession } from "./store.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// An assistant message carrying a single tool call, as the parent records it.
const toolCallMessage = (toolName: string, toolCallId: string): NewMessage => ({
  role: "assistant",
  parts: [
    { type: `tool-${toolName}`, toolCallId, state: "input-available", input: { task: "x" } },
  ] as unknown as UIMessage["parts"],
});

describe("childSessionTools", () => {
  it("registers investigate with its co-located worker guidance", () => {
    const entry = childSessionTools.get(INVESTIGATE_TOOL_NAME);
    expect(entry?.guidance).toBe(INVESTIGATE_CHILD_GUIDANCE);
  });
});

describe("childSessionGuidance", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-child-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // A child spawned from a parent's tool call with the given name. The parent
  // carries a user turn before the tool call, so the resolver skips it.
  const childOf = (toolName: string, toolCallId: string): Session => {
    createSession(db, MODEL, { id: "parent" });
    appendMessage(db, "parent", { role: "user", parts: [{ type: "text", text: "go" }] });
    appendMessage(db, "parent", toolCallMessage(toolName, toolCallId));
    return createSession(db, MODEL, {
      id: "child",
      parentSessionId: "parent",
      parentToolCallId: toolCallId,
    });
  };

  it("returns no overlay for a top-level session", () => {
    const top = createSession(db, MODEL, { id: "top" });
    expect(childSessionGuidance(db, top)).toBeUndefined();
  });

  it("resolves the spawning tool's overlay from the parent's tool call", () => {
    const child = childOf(INVESTIGATE_TOOL_NAME, "call_1");
    expect(childSessionGuidance(db, child)).toBe(INVESTIGATE_CHILD_GUIDANCE);
  });

  it("returns no overlay when the spawning call isn't a registered child-session tool", () => {
    const child = childOf("tavily__search", "call_1");
    expect(childSessionGuidance(db, child)).toBeUndefined();
  });

  it("returns no overlay when no recorded tool call matches the spawning id", () => {
    createSession(db, MODEL, { id: "parent" });
    appendMessage(db, "parent", toolCallMessage(INVESTIGATE_TOOL_NAME, "other-call"));
    const child = createSession(db, MODEL, {
      id: "child",
      parentSessionId: "parent",
      parentToolCallId: "missing",
    });
    expect(childSessionGuidance(db, child)).toBeUndefined();
  });
});
