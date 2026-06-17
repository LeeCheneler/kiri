import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { articles, messages, recommendations, runs, sessions } from "../db/schema.ts";
import { createApp } from "../index.ts";
import { type TestEnv, createTestEnv } from "./test-helpers.ts";

describe("activity routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  const insertRun = (id: string, startedAtMs: number) => {
    env.db
      .insert(runs)
      .values({
        id,
        workflowName: "wf",
        status: "ok",
        startedAt: new Date(startedAtMs),
        finishedAt: new Date(startedAtMs + 1000),
        definitionSnapshot: { name: "wf", steps: [] },
      })
      .run();
  };

  const insertSession = (id: string, startedAtMs: number) => {
    env.db
      .insert(sessions)
      .values({ id, status: "idle", model: "anthropic:claude", startedAt: new Date(startedAtMs) })
      .run();
  };

  type ActivityBody = {
    entries: Array<
      | {
          kind: "run";
          run: {
            id: string;
            articles: Array<{ name: string; heading: string | null }>;
            recommendationsCount: number;
          };
        }
      | { kind: "session"; session: { id: string; preview: string | null } }
    >;
    nextCursor: string | null;
  };

  const idOf = (e: ActivityBody["entries"][number]) => (e.kind === "run" ? e.run.id : e.session.id);

  const getActivity = async (query = "") => {
    const res = await createApp({ db: env.db, registry: env.registry, cwd: env.cwd }).request(
      `/api/activity${query}`,
    );
    return { status: res.status, body: (await res.json()) as ActivityBody };
  };

  describe("GET /api/activity", () => {
    it("interleaves runs and sessions newest-first by start time", async () => {
      insertRun("r1", 100);
      insertSession("s1", 200);
      insertRun("r2", 300);
      insertSession("s2", 400);

      const { status, body } = await getActivity();
      expect(status).toBe(200);
      expect(body.entries.map((e) => [e.kind, idOf(e)])).toEqual([
        ["session", "s2"],
        ["run", "r2"],
        ["session", "s1"],
        ["run", "r1"],
      ]);
      expect(body.nextCursor).toBeNull();
    });

    it("carries run enrichment and the session preview on their entries", async () => {
      insertRun("r1", 100);
      env.db
        .insert(articles)
        .values({
          id: "a1",
          runId: "r1",
          slug: "weekly",
          name: "Weekly",
          contentMd: "# Weekly digest\n\nbody",
          createdAt: new Date(150),
        })
        .run();
      env.db
        .insert(recommendations)
        .values({ id: "rec1", runId: "r1", index: 0, title: "Follow up", workflow: "wf" })
        .run();

      insertSession("s1", 200);
      env.db
        .insert(messages)
        .values({
          id: "m1",
          sessionId: "s1",
          index: 0,
          role: "user",
          parts: [{ type: "text", text: "Summarise the readme" }],
          createdAt: new Date(210),
        })
        .run();

      const { body } = await getActivity();
      const [sessionEntry, runEntry] = body.entries;
      if (runEntry.kind !== "run" || sessionEntry.kind !== "session") {
        throw new Error("unexpected entry kinds");
      }
      expect(runEntry.run.articles).toHaveLength(1);
      expect(runEntry.run.articles[0]).toMatchObject({ name: "Weekly", heading: "Weekly digest" });
      expect(runEntry.run.recommendationsCount).toBe(1);
      expect(sessionEntry.session.preview).toBe("Summarise the readme");
    });

    it("pages across the run/session boundary via the cursor", async () => {
      insertRun("r1", 100);
      insertSession("s1", 200);
      insertRun("r2", 300);
      insertSession("s2", 400);
      insertRun("r3", 500);

      const page1 = await getActivity("?limit=2");
      expect(page1.body.entries.map((e) => [e.kind, idOf(e)])).toEqual([
        ["run", "r3"],
        ["session", "s2"],
      ]);
      expect(page1.body.nextCursor).not.toBeNull();

      const page2 = await getActivity(`?limit=2&cursor=${page1.body.nextCursor}`);
      expect(page2.body.entries.map((e) => [e.kind, idOf(e)])).toEqual([
        ["run", "r2"],
        ["session", "s1"],
      ]);
      expect(page2.body.nextCursor).not.toBeNull();

      // Final page is short (one row left), so no further cursor.
      const page3 = await getActivity(`?limit=2&cursor=${page2.body.nextCursor}`);
      expect(page3.body.entries.map((e) => [e.kind, idOf(e)])).toEqual([["run", "r1"]]);
      expect(page3.body.nextCursor).toBeNull();
    });

    it("breaks ties on equal start time by id, descending", async () => {
      insertRun("r1", 100);
      insertSession("s1", 100); // identical start time forces the id tie-break

      const { body } = await getActivity();
      // Same startedAt → ordered by id DESC, so "s1" precedes "r1".
      expect(body.entries.map((e) => [e.kind, idOf(e)])).toEqual([
        ["session", "s1"],
        ["run", "r1"],
      ]);
    });

    it("returns an empty page when there is no activity", async () => {
      const { body } = await getActivity();
      expect(body.entries).toEqual([]);
      expect(body.nextCursor).toBeNull();
    });

    it("rejects a malformed cursor with 400", async () => {
      // base64url of "nope" — decodes to a value with no key separator.
      const bad = Buffer.from("nope").toString("base64url");
      const res = await createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
      }).request(`/api/activity?cursor=${bad}`);
      expect(res.status).toBe(400);
    });
  });
});
