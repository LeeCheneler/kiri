import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { articles, memories, messages, projects, runs, sessions } from "../db/schema.ts";
import { createRegistry } from "../workflows/index.ts";
import {
  type KnowledgeReference,
  MAX_KNOWLEDGE_BYTES,
  openKnowledge,
  searchKnowledge,
} from "./knowledge.ts";
import { search } from "./search.ts";

describe("knowledge retrieval", () => {
  let dir: string;
  let db: KiriDb;
  let registry: ReturnType<typeof createRegistry>;
  const date = new Date("2026-01-01T00:00:00Z");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-knowledge-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    registry = createRegistry();
    db.insert(projects)
      .values([
        { id: "p1", name: "First project", createdAt: date },
        { id: "p2", name: "Other project", createdAt: date },
      ])
      .run();
    db.insert(sessions)
      .values([
        { id: "s1", projectId: "p1", status: "idle", model: "m", startedAt: date },
        { id: "s2", projectId: "p2", status: "idle", model: "m", startedAt: date },
        { id: "standalone", status: "idle", model: "m", startedAt: date },
        {
          id: "worker",
          projectId: "p1",
          parentSessionId: "s1",
          status: "idle",
          model: "m",
          startedAt: date,
        },
      ])
      .run();
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("filters by project before limits and pages beyond the old scan cap", () => {
    db.insert(articles)
      .values(
        Array.from({ length: 140 }, (_, index) => ({
          id: `a-${String(index).padStart(3, "0")}`,
          projectId: index < 120 ? "p2" : "p1",
          slug: `a-${index}`,
          name: "Decision",
          contentMd: "Use pelican for delivery.",
          createdAt: date,
        })),
      )
      .run();
    const deps = { db, registry };
    const page = searchKnowledge(deps, { query: "pelican", scope: { projectId: "p1" }, limit: 10 });
    expect(page.results).toHaveLength(10);
    expect(page.results.every((hit) => hit.projectId === "p1")).toBe(true);
    const next = searchKnowledge(deps, {
      query: "pelican",
      scope: { projectId: "p1" },
      offset: page.nextOffset ?? 0,
      limit: 10,
    });
    expect(next.results).toHaveLength(10);
    expect(next.nextOffset).toBeNull();
    expect(new Set([...page.results, ...next.results].map((hit) => hit.reference.id)).size).toBe(
      20,
    );
    const tail = searchKnowledge(deps, { query: "pelican", scope: "workspace", offset: 130 });
    expect(tail.results).toHaveLength(10);
    expect(tail.nextOffset).toBeNull();
  });

  it("finds and opens an earlier conclusion with ownership, age and a link", () => {
    db.insert(messages)
      .values([
        {
          id: "m1",
          sessionId: "s1",
          index: 0,
          role: "user",
          parts: [{ type: "text", text: "Which store?" }],
          createdAt: date,
        },
        {
          id: "m2",
          sessionId: "s1",
          index: 1,
          role: "assistant",
          parts: [{ type: "text", text: "We chose Postgres because transactions matter." }],
          createdAt: date,
        },
        {
          id: "m3",
          sessionId: "s1",
          index: 2,
          role: "user",
          parts: [{ type: "text", text: "Agreed." }],
          createdAt: date,
        },
      ])
      .run();
    const hit = searchKnowledge({ db, registry }, { query: "Postgres", scope: { projectId: "p1" } })
      .results[0];
    expect(hit.reference).toMatchObject({ type: "session", id: "s1", messageId: "m2" });
    expect(hit.projectId).toBe("p1");
    expect(hit.createdAt).toBe(date.toISOString());
    expect(hit.href).toBe("/sessions/s1");
    const page = openKnowledge(
      { db, registry },
      { reference: hit.reference, scope: { projectId: "p1" } },
    );
    expect(page.messageCount).toBe(3);
    expect(page.excerpts.map((part) => part.text)).toEqual([
      "Which store?",
      "We chose Postgres because transactions matter.",
      "Agreed.",
    ]);
    expect(page.excerpts[1]).toMatchObject({
      role: "assistant",
      messageIndex: 1,
      createdAt: date.toISOString(),
    });
    expect(page.next).toBeNull();
  });

  it("searches within one session and rejects mismatched scope and message IDs", () => {
    db.insert(messages)
      .values([
        {
          id: "m1",
          sessionId: "s1",
          index: 0,
          role: "user",
          parts: [{ type: "text", text: "pelican" }],
          createdAt: date,
        },
        {
          id: "m2",
          sessionId: "s2",
          index: 0,
          role: "user",
          parts: [{ type: "text", text: "pelican" }],
          createdAt: date,
        },
      ])
      .run();
    const deps = { db, registry };
    expect(
      searchKnowledge(deps, { query: "pelican", scope: "workspace", sessionId: "s2" }).results.map(
        (hit) => hit.reference.id,
      ),
    ).toEqual(["s2"]);
    expect(() =>
      searchKnowledge(deps, { query: "pelican", scope: { projectId: "p1" }, sessionId: "s2" }),
    ).toThrow("scope");
    expect(() =>
      openKnowledge(deps, {
        reference: { type: "session", id: "s2", messageId: "m2" },
        scope: { projectId: "p1" },
      }),
    ).toThrow("scope");
    expect(() =>
      openKnowledge(deps, {
        reference: { type: "session", id: "s1", messageId: "m2" },
        scope: "workspace",
      }),
    ).toThrow("Message not found");
    expect(() =>
      openKnowledge(deps, {
        reference: { type: "session", id: "s1" },
        scope: { projectId: "missing" },
      }),
    ).toThrow("Unknown project");
  });

  it("anchors deep matches in a huge message and bounds every continuation", () => {
    const prefix = "Routine context. ".repeat(200_000);
    const body = `${prefix}The final decision was pelican. ${"🐦 repeated context. ".repeat(1000)}`;
    db.insert(messages)
      .values([
        {
          id: "before",
          sessionId: "s1",
          index: 0,
          role: "user",
          parts: [{ type: "text", text: "Earlier context. ".repeat(2000) }],
          createdAt: date,
        },
        {
          id: "huge",
          sessionId: "s1",
          index: 1,
          role: "assistant",
          parts: [
            { type: "text", text: body },
            { type: "tool-run_command", output: "TOOL_PAYLOAD" },
            { type: "reasoning", text: "PRIVATE_REASONING" },
            { type: "file", data: "IMAGE_PAYLOAD" },
          ],
          createdAt: date,
        },
        {
          id: "after",
          sessionId: "s1",
          index: 2,
          role: "user",
          parts: [{ type: "text", text: "Thanks." }],
          createdAt: date,
        },
      ])
      .run();
    const deps = { db, registry };
    const hit = searchKnowledge(deps, { query: "pelican", scope: "workspace" }).results[0];
    expect(hit.reference.type === "session" && hit.reference.offset).toBeGreaterThan(
      prefix.length - 100,
    );
    let page = openKnowledge(deps, { reference: hit.reference, scope: "workspace" });
    expect(page.excerpts.map((part) => part.text).join(" ")).toContain("decision was pelican");
    expect(page.previous).not.toBeNull();
    expect(page.previous?.reference).toEqual({ type: "session", id: "s1", messageId: "huge" });
    const earlier = openKnowledge(deps, {
      ...(page.previous as NonNullable<typeof page.previous>),
      scope: "workspace",
    });
    expect(earlier.excerpts[0].text).toContain("Routine context.");
    expect(earlier.excerpts[0].offset).toBeLessThan(page.excerpts[1].offset);
    expect(page.next).not.toBeNull();
    let pages = 0;
    while (true) {
      expect(
        page.excerpts.reduce((bytes, part) => bytes + Buffer.byteLength(part.text), 0),
      ).toBeLessThanOrEqual(MAX_KNOWLEDGE_BYTES);
      expect(JSON.stringify(page)).not.toContain("TOOL_PAYLOAD");
      expect(JSON.stringify(page)).not.toContain("PRIVATE_REASONING");
      expect(JSON.stringify(page)).not.toContain("IMAGE_PAYLOAD");
      expect(JSON.stringify(page)).not.toContain("�");
      if (!page.next) break;
      expect(++pages).toBeLessThan(10);
      page = openKnowledge(deps, { ...page.next, scope: "workspace" });
    }
    expect(page.excerpts.at(-1)?.text).toBe("Thanks.");
  });

  it("pages Unicode text without gaps or duplication, including a single oversized message", () => {
    const body = "🐦é漢字".repeat(300);
    db.insert(messages)
      .values({
        id: "unicode",
        sessionId: "s1",
        index: 0,
        role: "assistant",
        parts: [{ type: "text", text: body }],
        createdAt: date,
      })
      .run();
    let cursor: { reference: KnowledgeReference; offset: number } | null = {
      reference: { type: "session", id: "s1" },
      offset: 0,
    };
    let collected = "";
    while (cursor) {
      const page = openKnowledge(
        { db, registry },
        { ...cursor, scope: "workspace", maxBytes: 256 },
      );
      expect(
        page.excerpts.reduce((bytes, part) => bytes + Buffer.byteLength(part.text), 0),
      ).toBeLessThanOrEqual(256);
      collected += page.excerpts.map((part) => part.text).join("");
      cursor = page.next;
    }
    expect(collected).toBe(body);
  });

  it("opens the best multi-term match rather than an unrelated early occurrence", () => {
    db.insert(messages)
      .values({
        id: "multi",
        sessionId: "s1",
        index: 0,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `The database was discussed. ${"Routine context. ".repeat(2000)}The database decision was pelican.`,
          },
        ],
        createdAt: date,
      })
      .run();
    const hit = searchKnowledge({ db, registry }, { query: "database pelican", scope: "workspace" })
      .results[0];
    const page = openKnowledge(
      { db, registry },
      { reference: hit.reference, scope: "workspace", maxBytes: 256 },
    );
    expect(page.excerpts[0].text).toContain("database decision was pelican");
    const start = openKnowledge(
      { db, registry },
      { reference: { type: "session", id: "s1" }, scope: "workspace", offset: 4, maxBytes: 256 },
    );
    expect(start.excerpts[0].text.startsWith("database was discussed")).toBe(true);
  });

  it("opens a session without a match as a bounded, pageable beginning", () => {
    db.insert(messages)
      .values(
        Array.from({ length: 8 }, (_, index) => ({
          id: `m${index}`,
          sessionId: "s1",
          index,
          role: "user",
          parts: [{ type: "text", text: `Message ${index}` }],
          createdAt: date,
        })),
      )
      .run();
    const first = openKnowledge(
      { db, registry },
      { reference: { type: "session", id: "s1" }, scope: "workspace" },
    );
    expect(first.messageCount).toBe(8);
    expect(first.excerpts.map((part) => part.messageIndex)).toEqual([0, 1, 2, 3, 4]);
    const second = openKnowledge(
      { db, registry },
      { ...(first.next as NonNullable<typeof first.next>), scope: "workspace" },
    );
    expect(second.excerpts.map((part) => part.messageIndex)).toEqual([5, 6, 7]);
    expect(second.next).toBeNull();
    expect(second.previous?.reference).toEqual({ type: "session", id: "s1", messageId: "m4" });
    expect(() =>
      openKnowledge(
        { db, registry },
        {
          reference: { type: "session", id: "s1", messageId: "m0" },
          scope: "workspace",
          offset: 999,
        },
      ),
    ).toThrow("Offset");
  });

  it("continues at the next message when one message exactly fills the byte budget", () => {
    db.insert(messages)
      .values([
        {
          id: "full",
          sessionId: "s1",
          index: 0,
          role: "assistant",
          parts: [{ type: "text", text: "x".repeat(256) }],
          createdAt: date,
        },
        {
          id: "next",
          sessionId: "s1",
          index: 1,
          role: "user",
          parts: [{ type: "text", text: "Continue here." }],
          createdAt: date,
        },
      ])
      .run();
    const page = openKnowledge(
      { db, registry },
      { reference: { type: "session", id: "s1" }, scope: "workspace", maxBytes: 256 },
    );
    expect(page.excerpts).toHaveLength(1);
    expect(page.next).toEqual({
      reference: { type: "session", id: "s1", messageId: "next" },
      offset: 0,
    });
    const next = openKnowledge(
      { db, registry },
      { ...(page.next as NonNullable<typeof page.next>), scope: "workspace", maxBytes: 256 },
    );
    expect(next.excerpts.map((part) => part.text)).toEqual(["Continue here."]);
    expect(next.next).toBeNull();
  });

  it("opens title matches and empty sessions without inventing content", () => {
    db.update(sessions).set({ title: "Pelican review" }).where(eq(sessions.id, "s1")).run();
    const hit = searchKnowledge({ db, registry }, { query: "pelican", scope: "workspace" })
      .results[0];
    expect(hit.reference).toEqual({ type: "session", id: "s1" });
    const page = openKnowledge({ db, registry }, { reference: hit.reference, scope: "workspace" });
    expect(page.excerpts).toEqual([]);
    expect(page.messageCount).toBe(0);
    expect(page.next).toBeNull();
  });

  it("discovers workflow articles without a run ID and keeps workspace records out of project searches", () => {
    db.insert(runs)
      .values({
        id: "r1",
        workflowName: "pelican",
        status: "ok",
        summary: "Pelican report completed.",
        startedAt: date,
        definitionSnapshot: {},
      })
      .run();
    db.insert(articles)
      .values({
        id: "a1",
        runId: "r1",
        slug: "report",
        name: "Report",
        contentMd: "Pelican findings.",
        createdAt: date,
      })
      .run();
    registry.replace(new Map([["pelican", { name: "pelican", steps: [{ sh: "echo done" }] }]]));
    const deps = { db, registry };
    expect(searchKnowledge(deps, { query: "pelican", scope: { projectId: "p1" } }).results).toEqual(
      [],
    );
    const hits = searchKnowledge(deps, { query: "pelican", scope: "workspace" }).results;
    expect(hits.map((hit) => hit.reference.type).sort()).toEqual(["article", "run", "workflow"]);
    const article = hits.find((hit) => hit.reference.type === "article");
    expect(article?.href).toBe("/runs/r1/articles/report");
    for (const hit of hits) {
      expect(
        openKnowledge(deps, {
          reference: hit.reference,
          scope: "workspace",
        }).excerpts[0].text.toLowerCase(),
      ).toContain("pelican");
      expect(() =>
        openKnowledge(deps, { reference: hit.reference, scope: { projectId: "p1" } }),
      ).toThrow("scope");
    }
    const first = searchKnowledge(deps, { query: "pelican", scope: "workspace", limit: 2 });
    expect(first.nextOffset).toBe(2);
    const second = searchKnowledge(deps, {
      query: "pelican",
      scope: "workspace",
      limit: 2,
      offset: 2,
    });
    expect(second.results.map((hit) => hit.reference.type)).toEqual(["workflow"]);
    expect(second.nextOffset).toBeNull();
  });

  it("addresses identically named memories by ID and returns their real scope and modification age", () => {
    db.insert(memories)
      .values([
        {
          id: "global",
          name: "decision",
          description: "Pelican context",
          contentMd: "Global advice",
          createdAt: date,
          updatedAt: date,
        },
        {
          id: "local",
          projectId: "p1",
          name: "decision",
          description: "Pelican context",
          contentMd: "Local advice",
          createdAt: date,
          updatedAt: new Date("2026-02-01T00:00:00Z"),
        },
        {
          id: "other",
          projectId: "p2",
          name: "decision",
          description: "Pelican context",
          contentMd: "Other advice",
          createdAt: date,
          updatedAt: date,
        },
      ])
      .run();
    const deps = { db, registry };
    const hits = searchKnowledge(deps, { query: "pelican", scope: { projectId: "p1" } }).results;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      reference: { type: "memory", id: "local" },
      projectId: "p1",
      updatedAt: "2026-02-01T00:00:00.000Z",
      href: "/projects/p1/memories/decision",
    });
    expect(
      openKnowledge(deps, { reference: hits[0].reference, scope: "workspace" }).excerpts[0].text,
    ).toBe("Local advice");
    expect(() =>
      openKnowledge(deps, {
        reference: { type: "memory", id: "global" },
        scope: { projectId: "p1" },
      }),
    ).toThrow("scope");
    expect(search(deps, "pelican")).toEqual({
      articles: [],
      sessions: [],
      runs: [],
      workflows: [],
    });
  });

  it("pages workflow-only matches in stable name order and handles past-the-end offsets", () => {
    registry.replace(
      new Map([
        ["zebra", { name: "zebra", description: "Pelican report", steps: [{ sh: "echo zebra" }] }],
        ["ant", { name: "ant", description: "Pelican report", steps: [{ sh: "echo ant" }] }],
        ["bird", { name: "bird", description: "Pelican report", steps: [{ sh: "echo bird" }] }],
      ]),
    );
    const deps = { db, registry };
    const first = searchKnowledge(deps, { query: "pelican", scope: "workspace", limit: 2 });
    expect(first.results.map((hit) => hit.reference.id)).toEqual(["ant", "bird"]);
    expect(first.nextOffset).toBe(2);
    const second = searchKnowledge(deps, {
      query: "pelican",
      scope: "workspace",
      limit: 2,
      offset: 2,
    });
    expect(second.results.map((hit) => hit.reference.id)).toEqual(["zebra"]);
    expect(second.nextOffset).toBeNull();
    expect(
      searchKnowledge(deps, { query: "pelican", scope: "workspace", offset: 100 }),
    ).toMatchObject({ results: [], nextOffset: null });
  });

  it("rechecks live ownership and deletion on open, and bounds document pages", () => {
    const body = "🐦".repeat(1000);
    db.insert(articles)
      .values({
        id: "a1",
        sessionId: "s1",
        slug: "notes",
        name: "Pelican",
        contentMd: body,
        createdAt: date,
      })
      .run();
    const deps = { db, registry };
    const hit = searchKnowledge(deps, { query: "pelican", scope: { projectId: "p1" } }).results[0];
    expect(hit.projectId).toBe("p1");
    expect(hit.href).toBe("/sessions/s1/articles/notes");
    const page = openKnowledge(deps, {
      reference: hit.reference,
      scope: { projectId: "p1" },
      maxBytes: 256,
    });
    expect(Buffer.byteLength(page.excerpts[0].text)).toBe(256);
    expect(page.next?.offset).toBe(64);
    const next = openKnowledge(deps, {
      ...(page.next as NonNullable<typeof page.next>),
      scope: "workspace",
      maxBytes: 256,
    });
    expect(next.excerpts[0].offset).toBe(64);
    db.update(articles)
      .set({ contentMd: "Updated conclusion." })
      .where(eq(articles.id, "a1"))
      .run();
    expect(
      openKnowledge(deps, { reference: hit.reference, scope: "workspace" }).excerpts[0].text,
    ).toBe("Updated conclusion.");
    expect(() =>
      openKnowledge(deps, { reference: hit.reference, scope: "workspace", offset: 999 }),
    ).toThrow("Offset");
    db.delete(articles).where(eq(articles.id, "a1")).run();
    expect(() => openKnowledge(deps, { reference: hit.reference, scope: "workspace" })).toThrow(
      "not found",
    );
    expect(searchKnowledge(deps, { query: "pelican", scope: "workspace" }).results).toEqual([]);
  });

  it("keeps hidden workers, system messages, tool results and reasoning out of retrieval", () => {
    db.insert(messages)
      .values([
        {
          id: "m1",
          sessionId: "worker",
          index: 0,
          role: "assistant",
          parts: [{ type: "text", text: "pelican" }],
          createdAt: date,
        },
        {
          id: "m2",
          sessionId: "s1",
          index: 0,
          role: "system",
          parts: [{ type: "text", text: "pelican" }],
          createdAt: date,
        },
        {
          id: "m3",
          sessionId: "s1",
          index: 1,
          role: "assistant",
          parts: [
            { type: "reasoning", text: "pelican" },
            { type: "tool-run_command", output: "pelican" },
          ],
          createdAt: date,
        },
      ])
      .run();
    db.insert(articles)
      .values({
        id: "hidden",
        sessionId: "worker",
        slug: "notes",
        name: "Pelican",
        contentMd: "Internal worker notes.",
        createdAt: date,
      })
      .run();
    const deps = { db, registry };
    expect(searchKnowledge(deps, { query: "pelican", scope: "workspace" }).results).toEqual([]);
    expect(() =>
      openKnowledge(deps, { reference: { type: "session", id: "worker" }, scope: "workspace" }),
    ).toThrow("scope");
    expect(() =>
      openKnowledge(deps, { reference: { type: "article", id: "hidden" }, scope: "workspace" }),
    ).toThrow("scope");
    expect(() =>
      openKnowledge(deps, {
        reference: { type: "session", id: "s1", messageId: "m2" },
        scope: "workspace",
      }),
    ).toThrow("Message not found");
    expect(
      openKnowledge(deps, {
        reference: { type: "session", id: "s1" },
        scope: "workspace",
      }).excerpts.map((part) => part.text),
    ).toEqual([""]);
  });

  it("returns no matches and validates requested bounds", () => {
    const deps = { db, registry };
    expect(searchKnowledge(deps, { query: " ", scope: "workspace" })).toMatchObject({
      results: [],
      nextOffset: null,
    });
    expect(searchKnowledge(deps, { query: "nonexistent", scope: "workspace" })).toMatchObject({
      results: [],
      nextOffset: null,
    });
    expect(() => searchKnowledge(deps, { query: "x", scope: "workspace", limit: 999 })).toThrow();
    expect(() => searchKnowledge(deps, { query: "x", scope: "workspace", offset: -1 })).toThrow();
    expect(() =>
      openKnowledge(deps, {
        reference: { type: "session", id: "s1" },
        scope: "workspace",
        maxBytes: MAX_KNOWLEDGE_BYTES + 1,
      }),
    ).toThrow();
  });
});
