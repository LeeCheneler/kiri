import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { articles, messages, runs, sessions } from "../db/schema.ts";
import { createApp } from "../index.ts";
import type { WorkflowDefinition } from "../workflows/index.ts";
import { type TestEnv, createTestEnv } from "./test-helpers.ts";

describe("search routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  type SearchBody = {
    articles: Array<{ id: string; name: string; snippet: Array<{ text: string; match: boolean }> }>;
    sessions: Array<{ id: string; preview: string }>;
    runs: Array<{ id: string; workflowName: string }>;
    workflows: Array<{ name: string }>;
    error?: string;
  };

  const getSearch = async (query: string) => {
    const res = await createApp({ db: env.db, registry: env.registry, config: env.config }).request(
      `/api/search${query}`,
    );
    return { status: res.status, body: (await res.json()) as SearchBody };
  };

  const seedWorkflow = (name: string, description?: string) => {
    const def: WorkflowDefinition = { name, description, steps: [{ sh: "echo hi" }] };
    env.registry.replace(new Map([[name, def]]));
  };

  it("returns grouped hits across every entity type", async () => {
    env.db
      .insert(runs)
      .values({
        id: "r1",
        workflowName: "pelican-digest",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
        summary: "Collected pelican stories.",
      })
      .run();
    env.db
      .insert(articles)
      .values({
        id: "a1",
        runId: "r1",
        slug: "digest",
        name: "Pelican Digest",
        contentMd: "All the pelican news.",
        createdAt: new Date(),
      })
      .run();
    env.db
      .insert(sessions)
      .values({ id: "s1", status: "idle", model: "m", startedAt: new Date() })
      .run();
    env.db
      .insert(messages)
      .values({
        id: "m1",
        sessionId: "s1",
        index: 0,
        role: "user",
        parts: [{ type: "text", text: "pelican facts please" }],
        createdAt: new Date(),
      })
      .run();
    seedWorkflow("pelican-digest", "Gathers pelican news");

    const { status, body } = await getSearch("?q=pelican");
    expect(status).toBe(200);
    expect(body.articles.map((hit) => hit.id)).toEqual(["a1"]);
    expect(body.articles[0]?.snippet.some((segment) => segment.match)).toBe(true);
    expect(body.sessions).toEqual([
      expect.objectContaining({ id: "s1", preview: "pelican facts please" }),
    ]);
    expect(body.runs.map((hit) => hit.id)).toEqual(["r1"]);
    expect(body.workflows.map((w) => w.name)).toEqual(["pelican-digest"]);
  });

  it("returns empty results for a blank query rather than a 400", async () => {
    seedWorkflow("pelican-digest");

    const { status, body } = await getSearch("?q=");
    expect(status).toBe(200);
    expect(body).toEqual({ articles: [], sessions: [], runs: [], workflows: [] });
  });

  it("rejects a missing q param", async () => {
    const { status, body } = await getSearch("");
    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it.each(["0", "101", "abc"])("rejects limit=%s", async (limit) => {
    const { status, body } = await getSearch(`?q=x&limit=${limit}`);
    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("applies the limit to index-backed hits", async () => {
    env.db
      .insert(runs)
      .values({
        id: "r1",
        workflowName: "wf",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();
    for (const id of ["a1", "a2", "a3"]) {
      env.db
        .insert(articles)
        .values({
          id,
          runId: "r1",
          slug: id,
          name: `Pelican ${id}`,
          contentMd: "pelican",
          createdAt: new Date(),
        })
        .run();
    }

    const { status, body } = await getSearch("?q=pelican&limit=2");
    expect(status).toBe(200);
    expect(body.articles).toHaveLength(2);
  });
});
