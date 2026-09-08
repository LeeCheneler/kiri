import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolSet } from "ai";
import type { z } from "zod";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { articles, projects } from "../db/schema.ts";
import type { KnowledgePage, searchKnowledge } from "../search/knowledge.ts";
import { createRegistry } from "../workflows/index.ts";
import { knowledgeTools } from "./knowledge-tools.ts";
import { appendMessage, createSession } from "./store.ts";

describe("knowledgeTools", () => {
  let dir: string;
  let db: KiriDb;
  let registry: ReturnType<typeof createRegistry>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-knowledge-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    registry = createRegistry();
    db.insert(projects)
      .values([
        { id: "p1", name: "First", createdAt: new Date() },
        { id: "p2", name: "Second", createdAt: new Date() },
      ])
      .run();
    db.insert(articles)
      .values([
        {
          id: "a1",
          projectId: "p1",
          slug: "notes",
          name: "Pelican",
          contentMd: "First project's conclusion.",
          createdAt: new Date(),
        },
        {
          id: "a2",
          projectId: "p2",
          slug: "notes",
          name: "Pelican",
          contentMd: "Second project's conclusion.",
          createdAt: new Date(),
        },
      ])
      .run();
  });
  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = async <T>(tools: ToolSet, name: string, input: unknown): Promise<T> => {
    const tool = tools[name];
    if (!tool.execute) throw new Error("Tool has no execute");
    const args = (tool.inputSchema as z.ZodType).parse(input);
    return (await tool.execute(args as never, { toolCallId: "read", messages: [] })) as T;
  };
  type SearchResult = ReturnType<typeof searchKnowledge>;

  it("defaults search and open to the current project and returns reusable references and scope", async () => {
    const tools = knowledgeTools({ db, registry }, "p1");
    const result = await invoke<SearchResult>(tools, "search_knowledge", { query: "pelican" });
    expect(result.scope).toEqual({ projectId: "p1" });
    expect(result.results.map((hit) => hit.reference.id)).toEqual(["a1"]);
    const page = await invoke<KnowledgePage>(tools, "open_knowledge", {
      reference: result.results[0].reference,
    });
    expect(page.scope).toEqual(result.scope);
    expect(page.excerpts[0].text).toBe("First project's conclusion.");
    await expect(
      invoke(tools, "open_knowledge", { reference: { type: "article", id: "a2" } }),
    ).rejects.toThrow("scope");
  });

  it("supports explicit workspace or other-project scope without silently broadening", async () => {
    const tools = knowledgeTools({ db, registry }, "p1");
    const all = await invoke<SearchResult>(tools, "search_knowledge", {
      query: "pelican",
      scope: "workspace",
      limit: 1,
    });
    expect(all.results).toHaveLength(1);
    expect(all.nextOffset).toBe(1);
    const next = await invoke<SearchResult>(tools, "search_knowledge", {
      query: "pelican",
      scope: all.scope,
      offset: all.nextOffset,
      limit: 1,
    });
    expect(next.results[0].reference.id).not.toBe(all.results[0].reference.id);
    expect(next.nextOffset).toBeNull();
    const other = await invoke<SearchResult>(tools, "search_knowledge", {
      query: "pelican",
      scope: { projectId: "p2" },
    });
    expect(other.results.map((hit) => hit.reference.id)).toEqual(["a2"]);
    const page = await invoke<KnowledgePage>(tools, "open_knowledge", {
      reference: other.results[0].reference,
      scope: other.scope,
    });
    expect(page.excerpts[0].text).toBe("Second project's conclusion.");
    expect(
      (await invoke<SearchResult>(tools, "search_knowledge", { query: "missing" })).results,
    ).toEqual([]);
    expect(
      (
        await invoke<SearchResult>(knowledgeTools({ db, registry }, null), "search_knowledge", {
          query: "pelican",
        })
      ).results,
    ).toHaveLength(2);
  });

  it("forwards session filters, match anchors and bounded continuation", async () => {
    createSession(db, "test:model", { id: "old", projectId: "p1" });
    appendMessage(
      db,
      "old",
      {
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `Earlier context. ${"routine ".repeat(1000)}pelican ${"🐦".repeat(400)}`,
          },
        ],
      },
      { id: "match" },
    );
    const tools = knowledgeTools({ db, registry }, "p1");
    const found = await invoke<SearchResult>(tools, "search_knowledge", {
      query: "pelican",
      session_id: "old",
    });
    expect(found.results).toHaveLength(1);
    expect(found.results[0].reference).toMatchObject({
      type: "session",
      id: "old",
      messageId: "match",
    });
    const page = await invoke<KnowledgePage>(tools, "open_knowledge", {
      reference: found.results[0].reference,
      scope: found.scope,
      max_bytes: 256,
    });
    expect(page.excerpts[0].text).toContain("pelican");
    expect(Buffer.byteLength(page.excerpts[0].text)).toBeLessThanOrEqual(256);
    const next = await invoke<KnowledgePage>(tools, "open_knowledge", {
      ...page.next,
      scope: page.scope,
      max_bytes: 256,
    });
    expect(next.excerpts[0].offset).toBe(page.next?.offset ?? -1);
    expect(next.excerpts[0].text).not.toContain("pelican");
  });

  it("rejects invalid bounds and unknown scope before retrieval", async () => {
    const tools = knowledgeTools({ db, registry }, null);
    await expect(invoke(tools, "search_knowledge", { query: "x", limit: 1000 })).rejects.toThrow();
    await expect(
      invoke(tools, "search_knowledge", { query: "x", scope: { projectId: "missing" } }),
    ).rejects.toThrow("Unknown project");
    await expect(
      invoke(tools, "open_knowledge", {
        reference: { type: "article", id: "a1" },
        max_bytes: 1_000_000,
      }),
    ).rejects.toThrow();
  });
});
