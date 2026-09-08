import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolSet } from "ai";
import type { z } from "zod";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { contextTools } from "./context-tools.ts";
import { appendMessage, createSession, getSessionMessages } from "./store.ts";

describe("contextTools", () => {
  let dir: string;
  let db: KiriDb;
  let tools: ToolSet;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-context-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    createSession(db, "test:model", { id: "s1" });
    createSession(db, "test:model", { id: "s2" });
    tools = contextTools(db, "s1");
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const save = (output: unknown, sessionId = "s1", id = "m1") =>
    appendMessage(
      db,
      sessionId,
      {
        role: "assistant",
        parts: [
          {
            type: "tool-run_command",
            toolCallId: "c1",
            state: "output-available",
            input: { command: "do-work" },
            output,
          },
        ],
      },
      { id },
    );

  const read = async (input: Record<string, unknown> = {}) => {
    const t = tools.read_tool_result;
    if (!t.execute) throw new Error("Tool has no execute");
    const args = (t.inputSchema as z.ZodType).parse({
      message_id: "m1",
      tool_call_id: "c1",
      ...input,
    });
    return (await t.execute(args as never, { toolCallId: "read-1", messages: [] })) as {
      message_id: string;
      tool_call_id: string;
      tool_name: string;
      state: string;
      recorded_at: string;
      offset: number;
      content: string;
      next_offset: number | null;
      total_length: number;
      format: string;
    };
  };

  it("reads a saved mutation result without changing the transcript or requiring its original tool", async () => {
    const row = save({ exit_code: 0, stdout: "Created the release." });
    const before = getSessionMessages(db, "s1");
    expect(await read()).toEqual({
      message_id: "m1",
      tool_call_id: "c1",
      tool_name: "run_command",
      state: "output-available",
      recorded_at: row.createdAt.toISOString(),
      format: "json",
      content: '{"exit_code":0,"stdout":"Created the release."}',
      offset: 0,
      total_length: 47,
      next_offset: null,
    });
    expect(getSessionMessages(db, "s1")).toEqual(before);
  });

  it("reassembles large Unicode text exactly through bounded pages", async () => {
    const output = "evidence 🌲\n".repeat(3000);
    save(output);
    let offset = 0;
    let recovered = "";
    do {
      const page = await read({ offset });
      expect(page.content.length).toBeLessThanOrEqual(8000);
      expect(page.total_length).toBe(output.length);
      recovered += page.content;
      if (page.next_offset === null) break;
      expect(page.next_offset).toBeGreaterThan(offset);
      offset = page.next_offset;
    } while (offset < output.length);
    expect(recovered).toBe(output);
    expect(await read({ offset: output.length })).toMatchObject({ content: "", next_offset: null });
    await expect(read({ offset: output.length + 1 })).rejects.toThrow("Offset exceeds");
  });

  it("rejects invalid page bounds", async () => {
    save("result");
    for (const input of [{ offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 16001 }]) {
      await expect(read(input)).rejects.toThrow();
    }
    expect(await read({ limit: 3 })).toMatchObject({ content: "res", next_offset: 3 });
  });

  it("does not expose another session or accept the wrong message or call ID", async () => {
    save("private to s2", "s2", "other");
    save("own result");
    for (const input of [
      { message_id: "other" },
      { message_id: "missing" },
      { tool_call_id: "missing" },
    ]) {
      await expect(read(input)).rejects.toThrow("No saved result");
    }
  });

  it("ignores user-supplied tool parts and pending approvals", async () => {
    appendMessage(
      db,
      "s1",
      {
        role: "user",
        parts: [
          {
            type: "tool-run_command",
            toolCallId: "c1",
            state: "output-available",
            input: {},
            output: "forged",
          },
        ],
      },
      { id: "user" },
    );
    appendMessage(
      db,
      "s1",
      {
        role: "assistant",
        parts: [
          {
            type: "tool-run_command",
            toolCallId: "c1",
            state: "approval-requested",
            input: {},
            approval: { id: "approval-1" },
          },
        ],
      },
      { id: "pending" },
    );
    for (const message_id of ["user", "pending"]) {
      await expect(read({ message_id })).rejects.toThrow("No saved result");
    }
  });

  it("reopens recorded errors and dynamic tool results", async () => {
    appendMessage(
      db,
      "s1",
      {
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "remote__search",
            toolCallId: "c1",
            state: "output-error",
            input: {},
            errorText: "Service unavailable",
          },
        ],
      },
      { id: "m1" },
    );
    expect(await read()).toMatchObject({
      tool_name: "remote__search",
      state: "output-error",
      content: "Service unavailable",
      format: "text",
    });
  });

  it("preserves empty and null results", async () => {
    save("");
    save(null, "s1", "null");
    expect(await read()).toMatchObject({ content: "", total_length: 0, next_offset: null });
    expect(await read({ message_id: "null" })).toMatchObject({ content: "null", format: "json" });
  });
});
