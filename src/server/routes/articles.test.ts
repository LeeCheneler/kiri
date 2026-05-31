import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { articles, runs } from "../db/schema.ts";
import { createApp } from "../index.ts";
import { type TestEnv, createTestEnv } from "./test-helpers.ts";

describe("articles routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  describe("GET /api/articles/recent", () => {
    const seedRun = (id: string, workflowName: string) => {
      env.db
        .insert(runs)
        .values({
          id,
          workflowName,
          status: "ok",
          startedAt: new Date(),
          finishedAt: new Date(),
          definitionSnapshot: { name: workflowName, steps: [{ sh: "echo hi" }] },
        })
        .run();
    };

    const seedArticle = (
      runId: string,
      name: string,
      opts: { title?: string; contentMd?: string; createdAt: Date },
    ) => {
      env.db
        .insert(articles)
        .values({
          id: crypto.randomUUID(),
          runId,
          name,
          title: opts.title ?? name,
          contentMd: opts.contentMd ?? `# ${name}`,
          createdAt: opts.createdAt,
        })
        .run();
    };

    it("returns an empty array when nothing has been published", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/articles/recent");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("returns the 10 newest articles across runs, newest first, with the workflow name", async () => {
      seedRun("run-a", "alpha");
      seedRun("run-b", "beta");
      // Eleven articles across two runs with distinct, increasing timestamps
      // so the newest-first ordering is deterministic.
      const base = Date.UTC(2026, 0, 1, 12, 0, 0);
      seedArticle("run-a", "a1", { createdAt: new Date(base + 1000) });
      seedArticle("run-b", "b1", { title: "Beta One", createdAt: new Date(base + 2000) });
      seedArticle("run-a", "a2", { createdAt: new Date(base + 3000) });
      seedArticle("run-b", "b2", { createdAt: new Date(base + 4000) });
      seedArticle("run-a", "a3", { createdAt: new Date(base + 5000) });
      seedArticle("run-b", "b3", { createdAt: new Date(base + 6000) });
      seedArticle("run-a", "a4", { createdAt: new Date(base + 7000) });
      seedArticle("run-b", "b4", { createdAt: new Date(base + 8000) });
      seedArticle("run-a", "a5", { createdAt: new Date(base + 9000) });
      seedArticle("run-b", "b5", { createdAt: new Date(base + 10000) });
      seedArticle("run-a", "a6", { createdAt: new Date(base + 11000) });

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/articles/recent");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        runId: string;
        name: string;
        title: string;
        heading: string | null;
        createdAt: string;
        workflowName: string;
      }>;

      // Newest first, capped at 10 — the oldest article (a1) is excluded.
      expect(body.map((a) => a.name)).toEqual([
        "a6",
        "b5",
        "a5",
        "b4",
        "a4",
        "b3",
        "a3",
        "b2",
        "a2",
        "b1",
      ]);
      expect(body[0]).toEqual({
        runId: "run-a",
        name: "a6",
        title: "a6",
        heading: "a6",
        createdAt: new Date(base + 11000).toISOString(),
        workflowName: "alpha",
      });
      // The joined workflow name travels with each entry.
      expect(body.find((a) => a.name === "b1")?.workflowName).toBe("beta");
      expect(body.find((a) => a.name === "a3")?.workflowName).toBe("alpha");
      // Link metadata only — the markdown body is not in the payload.
      for (const entry of body) {
        expect(entry).not.toHaveProperty("contentMd");
      }
    });

    it("projects the first h1 from the markdown body as the entry heading", async () => {
      seedRun("run-a", "alpha");
      const base = Date.UTC(2026, 0, 1, 12, 0, 0);
      seedArticle("run-a", "with-h1", {
        contentMd: "# This Week in PRs\n\nBody copy.",
        createdAt: new Date(base + 1000),
      });
      seedArticle("run-a", "no-h1", {
        contentMd: "just a paragraph, no heading.",
        createdAt: new Date(base + 2000),
      });
      seedArticle("run-a", "fenced", {
        contentMd: "```\n# fenced not a heading\n```\n\n# Real Heading",
        createdAt: new Date(base + 3000),
      });

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/articles/recent");
      const body = (await res.json()) as Array<{ name: string; heading: string | null }>;

      expect(body.find((a) => a.name === "with-h1")?.heading).toBe("This Week in PRs");
      expect(body.find((a) => a.name === "no-h1")?.heading).toBeNull();
      expect(body.find((a) => a.name === "fenced")?.heading).toBe("Real Heading");
    });
  });
});
