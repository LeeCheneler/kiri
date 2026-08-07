import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { KiriEvent } from "../events/index.ts";
import { listMemories, memoryTools } from "./memory-tools.ts";

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (t: ToolSet[string], input: unknown): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)(input, {
    toolCallId: "call-1",
    messages: [],
  } as ToolExecutionOptions);

describe("memoryTools", () => {
  let dir: string;
  let db: KiriDb;
  let events: KiriEvent[];
  let tools: ToolSet;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-memory-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    events = [];
    tools = memoryTools(db, (event) => events.push(event));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const save = (name: string, description = "A fact.", body = "# Fact\n\nBody.\n") =>
    run(tools.save_memory, { name, description, content_md: body });

  describe("save_memory", () => {
    it("creates a memory and publishes memory.saved", async () => {
      const output = await save("prefers-bun", "Prefers bun over node.");

      expect(output).toEqual({ name: "prefers-bun", saved: "created" });
      expect(events).toContainEqual({ type: "memory.saved", name: "prefers-bun" });
      const read = (await run(tools.read_memory, { name: "prefers-bun" })) as {
        description: string;
        content_md: string;
      };
      expect(read.description).toBe("Prefers bun over node.");
      expect(read.content_md).toBe("# Fact\n\nBody.");
    });

    it("updates an existing name in place and bumps updated_at", async () => {
      await save("prefers-bun", "Old summary.", "Old body.\n");
      const before = listMemories(db)[0]?.updatedAt.getTime() ?? 0;
      await Bun.sleep(2);

      const output = await save("prefers-bun", "New summary.", "New body.\n");

      expect(output).toEqual({ name: "prefers-bun", saved: "updated" });
      const summaries = listMemories(db);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.description).toBe("New summary.");
      expect(summaries[0]?.updatedAt.getTime()).toBeGreaterThan(before);
      const read = (await run(tools.read_memory, { name: "prefers-bun" })) as {
        content_md: string;
      };
      expect(read.content_md).toBe("New body.");
    });
  });

  describe("read_memory", () => {
    it("returns the full body with the update timestamp", async () => {
      await save("release-style", "How releases are written.", "Group by feature.\n");

      const output = (await run(tools.read_memory, { name: "release-style" })) as {
        name: string;
        updated_at: string;
      };

      expect(output.name).toBe("release-style");
      expect(new Date(output.updated_at).getTime()).toBeGreaterThan(0);
    });

    it("rejects an unknown name, pointing at the index", async () => {
      expect(run(tools.read_memory, { name: "missing" })).rejects.toThrow(
        'No memory named "missing" — the memory index in your instructions lists what exists.',
      );
    });
  });

  describe("delete_memory", () => {
    it("deletes a memory and publishes memory.deleted", async () => {
      await save("stale-fact");

      const output = await run(tools.delete_memory, { name: "stale-fact" });

      expect(output).toEqual({ name: "stale-fact", deleted: true });
      expect(events).toContainEqual({ type: "memory.deleted", name: "stale-fact" });
      expect(listMemories(db)).toHaveLength(0);
    });

    it("rejects an unknown name", async () => {
      expect(run(tools.delete_memory, { name: "missing" })).rejects.toThrow(
        'No memory named "missing"',
      );
    });
  });

  describe("listMemories", () => {
    it("lists index entries alphabetically regardless of save order", async () => {
      await save("zulu", "Last alphabetically.");
      await save("alpha", "First alphabetically.");

      const summaries = listMemories(db);

      expect(summaries.map((s) => s.name)).toEqual(["alpha", "zulu"]);
      expect(summaries[0]?.description).toBe("First alphabetically.");
    });
  });
});
