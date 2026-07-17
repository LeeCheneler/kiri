import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import migration0017 from "../../../drizzle/0017_drop_session_token_totals.sql" with {
  type: "text",
};
import { type KiriDb, openDatabase } from "./index.ts";
import { migrate } from "./migrate.ts";
import { articles, messages, recommendations, runSteps, runs, sessions } from "./schema.ts";

describe("db", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-db-"));
    db = openDatabase(join(dir, "state.db"));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts a run + run_step and reads them back", () => {
    migrate(db);

    const startedAt = new Date(1_700_000_000_000);
    db.insert(runs)
      .values({
        id: "run-1",
        workflowName: "self-review",
        status: "ok",
        startedAt,
        definitionSnapshot: { name: "self-review", nodes: [] },
      })
      .run();

    db.insert(runSteps)
      .values({
        id: "node-1",
        runId: "run-1",
        index: 0,
        kind: "script",
        status: "ok",
        output: { foo: "bar" },
        traces: { stdout: "hello", stderr: "", durationMs: 12 },
      })
      .run();

    const run = db.select().from(runs).where(eq(runs.id, "run-1")).get();
    expect(run).toBeDefined();
    expect(run?.workflowName).toBe("self-review");
    expect(run?.startedAt).toEqual(startedAt);
    expect(run?.definitionSnapshot).toEqual({ name: "self-review", nodes: [] });

    const node = db.select().from(runSteps).where(eq(runSteps.id, "node-1")).get();
    expect(node).toBeDefined();
    expect(node?.kind).toBe("script");
    expect(node?.output).toEqual({ foo: "bar" });
  });

  it("declares run_steps.run_id → runs.id foreign key", () => {
    const fks = getTableConfig(runSteps).foreignKeys;
    expect(fks).toHaveLength(1);
    // drizzle's inline FK is a builder with an opaque shape; this cast
    // reaches the `.reference()` accessor that resolves the deferred
    // `() => runs.id` callback into the column pair we care about.
    const fk = fks[0] as unknown as {
      reference: () => {
        columns: { name: string }[];
        foreignColumns: { name: string }[];
      };
    };
    const ref = fk.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(["run_id"]);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
  });

  it("declares articles.run_id and session_id foreign keys to their producers", () => {
    const fks = getTableConfig(articles).foreignKeys;
    expect(fks).toHaveLength(2);
    const refs = fks.map((fk) =>
      (
        fk as unknown as {
          reference: () => {
            columns: { name: string }[];
            foreignColumns: { name: string }[];
          };
        }
      ).reference(),
    );
    const columnNames = refs.map((r) => r.columns.map((c) => c.name).join(",")).sort();
    expect(columnNames).toEqual(["run_id", "session_id"]);
    for (const ref of refs) {
      expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
    }
  });

  it("re-running migrate is a no-op", () => {
    migrate(db);
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-1",
        workflowName: "x",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();

    const count = db.$client
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM runs")
      .get();
    expect(count?.count).toBe(1);
  });

  it("round-trips runs.summary and run_steps.is_summary", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-2",
        workflowName: "summed",
        status: "ok",
        startedAt: new Date(1_700_000_000_000),
        definitionSnapshot: { name: "summed", steps: [] },
        summary: "two steps ran cleanly.",
      })
      .run();

    db.insert(runSteps)
      .values({
        id: "summary-1",
        runId: "run-2",
        index: 0,
        kind: "use",
        status: "ok",
        isSummary: true,
      })
      .run();

    const run = db.select().from(runs).where(eq(runs.id, "run-2")).get();
    expect(run?.summary).toBe("two steps ran cleanly.");

    const summaryStep = db.select().from(runSteps).where(eq(runSteps.id, "summary-1")).get();
    expect(summaryStep?.isSummary).toBe(true);
  });

  it("defaults isSummary to false and summary to null on existing-shape inserts", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-3",
        workflowName: "plain",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();

    db.insert(runSteps)
      .values({
        id: "step-1",
        runId: "run-3",
        index: 0,
        kind: "sh",
        status: "ok",
      })
      .run();

    const run = db.select().from(runs).where(eq(runs.id, "run-3")).get();
    expect(run?.summary).toBeNull();

    const step = db.select().from(runSteps).where(eq(runSteps.id, "step-1")).get();
    expect(step?.isSummary).toBe(false);
  });

  it("adds summary and is_summary columns when migrating a pre-summary DB", () => {
    const sqlite = db.$client;
    sqlite.run(
      "CREATE TABLE __kiri_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
    );
    sqlite.run(`CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      definition_snapshot TEXT NOT NULL
    )`);
    sqlite.run(`CREATE TABLE run_steps (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      "index" INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      error TEXT,
      traces TEXT,
      usage TEXT,
      materials TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    )`);
    sqlite.run("CREATE INDEX run_steps_run_id_idx ON run_steps (run_id)");
    sqlite.run(
      "INSERT INTO __kiri_migrations (name, applied_at) VALUES ('0000_initial', 0), ('0001_index_run_nodes_run_id', 0), ('0002_rename_run_nodes_to_run_steps', 0)",
    );
    sqlite.run(
      "INSERT INTO runs (id, workflow_name, status, trigger, started_at, definition_snapshot) VALUES ('r1', 'wf', 'ok', 'manual', 0, '{}')",
    );

    migrate(db);

    const runRow = sqlite
      .query<{ summary: string | null }, []>("SELECT summary FROM runs WHERE id = 'r1'")
      .get();
    expect(runRow).toEqual({ summary: null });

    const stepCols = sqlite
      .query<{ name: string }, []>("PRAGMA table_info(run_steps)")
      .all()
      .map((r) => r.name);
    expect(stepCols).toContain("is_summary");
    // 0006/0007 drop the legacy materials snapshot and unused usage
    // columns at the same time.
    expect(stepCols).not.toContain("materials");
    expect(stepCols).not.toContain("usage");
  });

  it("round-trips articles rows", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-art",
        workflowName: "digester",
        status: "ok",
        startedAt: new Date(1_700_000_000_000),
        definitionSnapshot: { name: "digester", steps: [] },
      })
      .run();

    const createdAt = new Date(1_700_000_005_000);
    db.insert(articles)
      .values({
        id: "art-1",
        runId: "run-art",
        slug: "digest",
        name: "Digest",
        contentMd: "# Top story\n\nA thing happened.",
        createdAt,
      })
      .run();

    const row = db.select().from(articles).where(eq(articles.id, "art-1")).get();
    expect(row).toBeDefined();
    expect(row?.runId).toBe("run-art");
    expect(row?.slug).toBe("digest");
    expect(row?.name).toBe("Digest");
    expect(row?.contentMd).toBe("# Top story\n\nA thing happened.");
    expect(row?.createdAt).toEqual(createdAt);
  });

  it("enforces (run_id, slug) uniqueness on articles", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-uniq",
        workflowName: "x",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();

    db.insert(articles)
      .values({
        id: "art-a",
        runId: "run-uniq",
        slug: "digest",
        name: "Digest",
        contentMd: "a",
        createdAt: new Date(),
      })
      .run();

    expect(() =>
      db
        .insert(articles)
        .values({
          id: "art-b",
          runId: "run-uniq",
          slug: "digest",
          name: "Other",
          contentMd: "b",
          createdAt: new Date(),
        })
        .run(),
    ).toThrow();
  });

  it("allows the same article slug across different runs", () => {
    migrate(db);

    for (const runId of ["run-x", "run-y"] as const) {
      db.insert(runs)
        .values({
          id: runId,
          workflowName: "x",
          status: "ok",
          startedAt: new Date(),
          definitionSnapshot: {},
        })
        .run();
      db.insert(articles)
        .values({
          id: `${runId}-digest`,
          runId,
          slug: "digest",
          name: "Digest",
          contentMd: "ok",
          createdAt: new Date(),
        })
        .run();
    }

    const rows = db.select().from(articles).all();
    expect(rows).toHaveLength(2);
  });

  it("round-trips a session-linked article", () => {
    migrate(db);

    db.insert(sessions)
      .values({
        id: "sess-art",
        status: "idle",
        model: "lmstudio:gemma-4-26b-a4b-qat",
        startedAt: new Date(),
      })
      .run();

    db.insert(articles)
      .values({
        id: "art-sess",
        sessionId: "sess-art",
        slug: "digest",
        name: "Digest",
        contentMd: "# From a session",
        createdAt: new Date(),
      })
      .run();

    const row = db.select().from(articles).where(eq(articles.id, "art-sess")).get();
    expect(row?.sessionId).toBe("sess-art");
    expect(row?.runId).toBeNull();
  });

  it("enforces (session_id, slug) uniqueness but allows reuse across sessions", () => {
    migrate(db);

    for (const sessionId of ["sess-a", "sess-b"] as const) {
      db.insert(sessions)
        .values({
          id: sessionId,
          status: "idle",
          model: "lmstudio:gemma-4-26b-a4b-qat",
          startedAt: new Date(),
        })
        .run();
      db.insert(articles)
        .values({
          id: `${sessionId}-digest`,
          sessionId,
          slug: "digest",
          name: "Digest",
          contentMd: "ok",
          createdAt: new Date(),
        })
        .run();
    }
    expect(db.select().from(articles).all()).toHaveLength(2);

    expect(() =>
      db
        .insert(articles)
        .values({
          id: "sess-a-digest-dupe",
          sessionId: "sess-a",
          slug: "digest",
          name: "Other",
          contentMd: "dupe",
          createdAt: new Date(),
        })
        .run(),
    ).toThrow();
  });

  it("rejects an article with no producer or both producers", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-both",
        workflowName: "x",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();
    db.insert(sessions)
      .values({
        id: "sess-both",
        status: "idle",
        model: "lmstudio:gemma-4-26b-a4b-qat",
        startedAt: new Date(),
      })
      .run();

    expect(() =>
      db
        .insert(articles)
        .values({
          id: "art-orphan",
          slug: "digest",
          name: "Digest",
          contentMd: "no producer",
          createdAt: new Date(),
        })
        .run(),
    ).toThrow();

    expect(() =>
      db
        .insert(articles)
        .values({
          id: "art-dual",
          runId: "run-both",
          sessionId: "sess-both",
          slug: "digest",
          name: "Digest",
          contentMd: "two producers",
          createdAt: new Date(),
        })
        .run(),
    ).toThrow();
  });

  it("round-trips run_steps.is_article", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-pub",
        workflowName: "x",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();

    db.insert(runSteps)
      .values({
        id: "article-step-1",
        runId: "run-pub",
        index: 0,
        kind: "use",
        status: "ok",
        isArticle: true,
      })
      .run();

    db.insert(runSteps)
      .values({
        id: "regular-step-1",
        runId: "run-pub",
        index: 1,
        kind: "sh",
        status: "ok",
      })
      .run();

    const articleRow = db.select().from(runSteps).where(eq(runSteps.id, "article-step-1")).get();
    expect(articleRow?.isArticle).toBe(true);
    expect(articleRow?.isSummary).toBe(false);

    const regularRow = db.select().from(runSteps).where(eq(runSteps.id, "regular-step-1")).get();
    expect(regularRow?.isArticle).toBe(false);
  });

  it("adds the article step flag + articles table when migrating a pre-articles DB", () => {
    const sqlite = db.$client;
    sqlite.run(
      "CREATE TABLE __kiri_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
    );
    sqlite.run(`CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      definition_snapshot TEXT NOT NULL,
      summary TEXT
    )`);
    sqlite.run(`CREATE TABLE run_steps (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      "index" INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      error TEXT,
      traces TEXT,
      usage TEXT,
      materials TEXT NOT NULL,
      is_summary INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    )`);
    sqlite.run("CREATE INDEX run_steps_run_id_idx ON run_steps (run_id)");
    sqlite.run(
      "INSERT INTO __kiri_migrations (name, applied_at) VALUES ('0000_initial', 0), ('0001_index_run_nodes_run_id', 0), ('0002_rename_run_nodes_to_run_steps', 0), ('0003_add_run_summary_columns', 0)",
    );
    sqlite.run(
      "INSERT INTO runs (id, workflow_name, status, trigger, started_at, definition_snapshot) VALUES ('r1', 'wf', 'ok', 'manual', 0, '{}')",
    );

    migrate(db);

    const stepCols = sqlite
      .query<{ name: string }, []>("PRAGMA table_info(run_steps)")
      .all()
      .map((r) => r.name);
    expect(stepCols).toContain("is_article");

    const tables = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='articles'",
      )
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(["articles"]);

    const indexes = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='articles' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name)
      .sort();
    expect(indexes).toEqual([
      "articles_run_id_idx",
      "articles_run_id_slug_unique",
      "articles_session_id_idx",
      "articles_session_id_slug_unique",
    ]);
  });

  it("renames run_nodes → run_steps on a pre-rename DB and preserves rows", () => {
    const sqlite = db.$client;
    sqlite.run(
      "CREATE TABLE __kiri_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
    );
    sqlite.run(`CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      definition_snapshot TEXT NOT NULL
    )`);
    sqlite.run(`CREATE TABLE run_nodes (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      "index" INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      error TEXT,
      traces TEXT,
      usage TEXT,
      materials TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    )`);
    sqlite.run("CREATE INDEX run_nodes_run_id_idx ON run_nodes (run_id)");
    sqlite.run(
      "INSERT INTO __kiri_migrations (name, applied_at) VALUES ('0000_initial', 0), ('0001_index_run_nodes_run_id', 0)",
    );
    sqlite.run(
      "INSERT INTO runs (id, workflow_name, status, trigger, started_at, definition_snapshot) VALUES ('r1', 'wf', 'ok', 'manual', 0, '{}')",
    );
    sqlite.run(
      "INSERT INTO run_nodes (id, run_id, \"index\", kind, status, materials) VALUES ('n1', 'r1', 0, 'script', 'ok', '{\"source\":\"echo hi\"}')",
    );

    migrate(db);

    expect(
      sqlite
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('run_nodes','run_steps')",
        )
        .all()
        .map((r) => r.name)
        .sort(),
    ).toEqual(["run_steps"]);

    const indexes = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='run_steps' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name);
    expect(indexes).toEqual(["run_steps_run_id_idx"]);

    const preserved = sqlite
      .query<{ id: string; kind: string; status: string }, []>(
        "SELECT id, kind, status FROM run_steps WHERE id = 'n1'",
      )
      .get();
    // The rename preserved the row through 0002; later migrations
    // (0006) drop the `materials` column. The row still survives.
    expect(preserved).toEqual({ id: "n1", kind: "script", status: "ok" });
  });

  it("round-trips a fully-populated recommendation row", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-src",
        workflowName: "aggregator",
        status: "ok",
        startedAt: new Date(1_700_000_000_000),
        definitionSnapshot: {},
      })
      .run();
    db.insert(runs)
      .values({
        id: "run-actioned",
        workflowName: "pr-review",
        status: "ok",
        startedAt: new Date(1_700_000_005_000),
        definitionSnapshot: {},
      })
      .run();

    const actionedAt = new Date(1_700_000_010_000);
    db.insert(recommendations)
      .values({
        id: "rec-1",
        runId: "run-src",
        index: 0,
        title: "Review PR #123",
        description: "+500/-200, refactor user auth",
        workflow: "pr-review",
        inputs: { pr_number: "123" },
        actionedRunId: "run-actioned",
        actionedAt,
      })
      .run();

    const row = db.select().from(recommendations).where(eq(recommendations.id, "rec-1")).get();
    expect(row).toEqual({
      id: "rec-1",
      runId: "run-src",
      index: 0,
      title: "Review PR #123",
      description: "+500/-200, refactor user auth",
      workflow: "pr-review",
      inputs: { pr_number: "123" },
      actionedRunId: "run-actioned",
      actionedAt,
    });
  });

  it("defaults nullable recommendation fields to null when omitted", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-min",
        workflowName: "x",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();

    db.insert(recommendations)
      .values({
        id: "rec-min",
        runId: "run-min",
        index: 0,
        title: "Do the thing",
        workflow: "do-thing",
      })
      .run();

    const row = db.select().from(recommendations).where(eq(recommendations.id, "rec-min")).get();
    expect(row?.description).toBeNull();
    expect(row?.inputs).toBeNull();
    expect(row?.actionedRunId).toBeNull();
    expect(row?.actionedAt).toBeNull();
  });

  it("declares recommendations.run_id and actioned_run_id foreign keys to runs.id", () => {
    const fks = getTableConfig(recommendations).foreignKeys;
    expect(fks).toHaveLength(2);
    const refs = fks.map((fk) =>
      (
        fk as unknown as {
          reference: () => {
            columns: { name: string }[];
            foreignColumns: { name: string }[];
          };
        }
      ).reference(),
    );
    const columnNames = refs.map((r) => r.columns.map((c) => c.name).join(",")).sort();
    expect(columnNames).toEqual(["actioned_run_id", "run_id"]);
    for (const ref of refs) {
      expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
    }
  });

  it("adds the recommendations table when migrating a pre-recommendations DB", () => {
    const sqlite = db.$client;
    sqlite.run(
      "CREATE TABLE __kiri_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
    );
    sqlite.run(`CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      definition_snapshot TEXT NOT NULL,
      summary TEXT,
      git_sha TEXT,
      git_dirty INTEGER,
      inputs TEXT
    )`);
    sqlite.run(`CREATE TABLE run_steps (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      "index" INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      error TEXT,
      traces TEXT,
      is_summary INTEGER DEFAULT 0 NOT NULL,
      is_publish INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    )`);
    sqlite.run("CREATE INDEX run_steps_run_id_idx ON run_steps (run_id)");
    sqlite.run(`CREATE TABLE articles (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      content_md TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    )`);
    sqlite.run("CREATE UNIQUE INDEX articles_run_id_name_unique ON articles (run_id, name)");
    sqlite.run("CREATE INDEX articles_run_id_idx ON articles (run_id)");
    sqlite.run(
      `INSERT INTO __kiri_migrations (name, applied_at) VALUES
        ('0000_initial', 0),
        ('0001_index_run_nodes_run_id', 0),
        ('0002_rename_run_nodes_to_run_steps', 0),
        ('0003_add_run_summary_columns', 0),
        ('0004_add_publish_support', 0),
        ('0005_add_run_git_columns', 0),
        ('0006_drop_step_materials', 0),
        ('0007_drop_step_usage', 0),
        ('0008_rename_run_artefacts_to_articles', 0),
        ('0009_add_run_inputs', 0)`,
    );
    // A step flagged with the pre-0018 is_publish column — the rename
    // migration must carry the value into is_article.
    sqlite.run(
      "INSERT INTO runs (id, workflow_name, status, trigger, started_at, definition_snapshot) VALUES ('r1', 'wf', 'ok', 'manual', 0, '{}')",
    );
    sqlite.run(
      `INSERT INTO run_steps (id, run_id, "index", kind, status, is_summary, is_publish) VALUES ('s1', 'r1', 0, 'use', 'ok', 0, 1)`,
    );

    migrate(db);

    const flag = sqlite
      .query<{ is_article: number }, []>("SELECT is_article FROM run_steps WHERE id = 's1'")
      .get();
    expect(flag?.is_article).toBe(1);

    const tables = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='recommendations'",
      )
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(["recommendations"]);

    const columns = sqlite
      .query<{ name: string }, []>("PRAGMA table_info(recommendations)")
      .all()
      .map((r) => r.name)
      .sort();
    expect(columns).toEqual(
      [
        "actioned_at",
        "actioned_run_id",
        "description",
        "id",
        "index",
        "inputs",
        "run_id",
        "title",
        "workflow",
      ].sort(),
    );

    const indexes = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='recommendations' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name)
      .sort();
    expect(indexes).toEqual(["recommendations_actioned_run_id_idx", "recommendations_run_id_idx"]);
  });

  it("round-trips a session + message with parts and a context footprint", () => {
    migrate(db);

    const startedAt = new Date(1_700_000_000_000);
    db.insert(sessions)
      .values({
        id: "sess-1",
        status: "idle",
        model: "lmstudio:gemma-4-26b-a4b-qat",
        startedAt,
      })
      .run();

    const createdAt = new Date(1_700_000_005_000);
    db.insert(messages)
      .values({
        id: "msg-1",
        sessionId: "sess-1",
        index: 0,
        role: "assistant",
        parts: [{ type: "text", text: "Hello there." }],
        contextTokens: 46,
        createdAt,
      })
      .run();

    const session = db.select().from(sessions).where(eq(sessions.id, "sess-1")).get();
    expect(session?.status).toBe("idle");
    expect(session?.model).toBe("lmstudio:gemma-4-26b-a4b-qat");
    expect(session?.startedAt).toEqual(startedAt);

    const message = db.select().from(messages).where(eq(messages.id, "msg-1")).get();
    expect(message?.sessionId).toBe("sess-1");
    expect(message?.role).toBe("assistant");
    expect(message?.parts).toEqual([{ type: "text", text: "Hello there." }]);
    expect(message?.contextTokens).toBe(46);
    expect(message?.createdAt).toEqual(createdAt);
  });

  it("defaults a session's nullable fields to null", () => {
    migrate(db);

    db.insert(sessions)
      .values({
        id: "sess-min",
        status: "idle",
        model: "lmstudio:gemma-4-26b-a4b-qat",
        startedAt: new Date(),
      })
      .run();

    db.insert(messages)
      .values({
        id: "msg-user",
        sessionId: "sess-min",
        index: 0,
        role: "user",
        parts: [{ type: "text", text: "Hi" }],
        createdAt: new Date(),
      })
      .run();

    const session = db.select().from(sessions).where(eq(sessions.id, "sess-min")).get();
    expect(session?.finishedAt).toBeNull();
    expect(session?.error).toBeNull();

    const message = db.select().from(messages).where(eq(messages.id, "msg-user")).get();
    expect(message?.contextTokens).toBeNull();
  });

  it("0017 backfills context_tokens from the legacy usage column, then drops it", () => {
    // Stand up the pre-0017 messages shape and run the migration's messages
    // statements: each turn's recorded footprint must carry forward, the rest of
    // the usage JSON is dropped, and rows without a footprint settle to null.
    const sqlite = db.$client;
    sqlite.run("CREATE TABLE `messages` (`id` text, `usage` text)");
    sqlite.run(
      `INSERT INTO messages VALUES
         ('with-footprint', '{"totalTokens":46,"contextTokens":46}'),
         ('no-footprint', '{"totalTokens":5}'),
         ('user-turn', NULL)`,
    );

    for (const statement of migration0017
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.includes("`messages`"))) {
      sqlite.run(statement);
    }

    const rows = sqlite
      .query<{ id: string; context_tokens: number | null }, []>(
        "SELECT id, context_tokens FROM messages ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      { id: "no-footprint", context_tokens: null },
      { id: "user-turn", context_tokens: null },
      { id: "with-footprint", context_tokens: 46 },
    ]);
  });

  it("declares messages.session_id → sessions.id foreign key", () => {
    const fks = getTableConfig(messages).foreignKeys;
    expect(fks).toHaveLength(1);
    const fk = fks[0] as unknown as {
      reference: () => {
        columns: { name: string }[];
        foreignColumns: { name: string }[];
      };
    };
    const ref = fk.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(["session_id"]);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
  });

  it("declares sessions.parent_session_id → sessions.id self foreign key", () => {
    const fks = getTableConfig(sessions).foreignKeys;
    expect(fks).toHaveLength(1);
    const fk = fks[0] as unknown as {
      reference: () => {
        columns: { name: string }[];
        foreignColumns: { name: string }[];
      };
    };
    const ref = fk.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(["parent_session_id"]);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
  });

  it("adds the sessions + messages tables when migrating a pre-sessions DB", () => {
    const sqlite = db.$client;
    sqlite.run(
      "CREATE TABLE __kiri_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
    );
    // Seed the migration ledger through 0013 so the session migrations
    // (0014 creating the tables, 0015 dropping the agent columns, 0016 adding
    // the persona column, 0017 dropping the running-token columns) are the ones
    // outstanding. 0018 renames run_steps.is_publish, 0019 rebuilds articles,
    // and 0022's backfill reads runs, so the fixture carries a minimal shape
    // of each; the other run-side tables stay irrelevant.
    sqlite.run(`CREATE TABLE run_steps (
      id TEXT PRIMARY KEY NOT NULL,
      is_publish INTEGER DEFAULT 0 NOT NULL
    )`);
    sqlite.run(
      "CREATE TABLE runs (id TEXT PRIMARY KEY NOT NULL, workflow_name TEXT, summary TEXT)",
    );
    sqlite.run(`CREATE TABLE articles (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      content_md TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    const priorMigrations = [
      "0000_initial",
      "0001_index_run_nodes_run_id",
      "0002_rename_run_nodes_to_run_steps",
      "0003_add_run_summary_columns",
      "0004_add_publish_support",
      "0005_add_run_git_columns",
      "0006_drop_step_materials",
      "0007_drop_step_usage",
      "0008_rename_run_artefacts_to_articles",
      "0009_add_run_inputs",
      "0010_add_recommendations",
      "0011_drop_run_trigger",
      "0012_add_run_step_timing",
      "0013_rename_article_columns",
    ];
    sqlite.run(
      `INSERT INTO __kiri_migrations (name, applied_at) VALUES ${priorMigrations
        .map((name) => `('${name}', 0)`)
        .join(", ")}`,
    );

    migrate(db);

    const tables = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','messages') ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(["messages", "sessions"]);

    const sessionCols = sqlite
      .query<{ name: string }, []>("PRAGMA table_info(sessions)")
      .all()
      .map((r) => r.name)
      .sort();
    expect(sessionCols).toEqual(
      [
        "error",
        "finished_at",
        "id",
        "image_model",
        "model",
        "parent_session_id",
        "parent_tool_call_id",
        "persona",
        "pinned",
        "started_at",
        "status",
      ].sort(),
    );

    const indexes = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='messages' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name);
    expect(indexes).toEqual(["messages_session_id_idx"]);

    const sessionIndexes = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sessions' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name);
    expect(sessionIndexes).toEqual(["sessions_parent_session_id_idx"]);
  });

  it("preserves article rows when migrating a pre-decoupling DB", () => {
    const sqlite = db.$client;
    sqlite.run(
      "CREATE TABLE __kiri_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
    );
    // Stand up the post-0018 shape 0019 rebuilds `articles` from: the old
    // NOT NULL run_id column, plus the runs/sessions parents its foreign
    // keys enforce during the copy. 0022's backfill also reads messages,
    // so the fixture carries its minimal shape.
    sqlite.run(`CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      definition_snapshot TEXT NOT NULL,
      summary TEXT,
      git_sha TEXT,
      git_dirty INTEGER,
      inputs TEXT
    )`);
    sqlite.run(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      model TEXT NOT NULL,
      persona TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT
    )`);
    sqlite.run(`CREATE TABLE articles (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      content_md TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    )`);
    sqlite.run("CREATE UNIQUE INDEX articles_run_id_slug_unique ON articles (run_id, slug)");
    sqlite.run("CREATE INDEX articles_run_id_idx ON articles (run_id)");
    sqlite.run(`CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      parts TEXT NOT NULL
    )`);
    const priorMigrations = [
      "0000_initial",
      "0001_index_run_nodes_run_id",
      "0002_rename_run_nodes_to_run_steps",
      "0003_add_run_summary_columns",
      "0004_add_publish_support",
      "0005_add_run_git_columns",
      "0006_drop_step_materials",
      "0007_drop_step_usage",
      "0008_rename_run_artefacts_to_articles",
      "0009_add_run_inputs",
      "0010_add_recommendations",
      "0011_drop_run_trigger",
      "0012_add_run_step_timing",
      "0013_rename_article_columns",
      "0014_add_sessions_and_messages",
      "0015_drop_session_agent_columns",
      "0016_add_session_persona",
      "0017_drop_session_token_totals",
      "0018_rename_is_publish_to_is_article",
    ];
    sqlite.run(
      `INSERT INTO __kiri_migrations (name, applied_at) VALUES ${priorMigrations
        .map((name) => `('${name}', 0)`)
        .join(", ")}`,
    );
    sqlite.run(
      "INSERT INTO runs (id, workflow_name, status, started_at, definition_snapshot) VALUES ('r1', 'wf', 'ok', 0, '{}')",
    );
    sqlite.run(
      "INSERT INTO articles (id, run_id, slug, name, content_md, created_at) VALUES ('a1', 'r1', 'digest', 'Digest', '# Hi', 0)",
    );

    migrate(db);

    const preserved = sqlite
      .query<{ id: string; run_id: string; session_id: string | null }, []>(
        "SELECT id, run_id, session_id FROM articles WHERE id = 'a1'",
      )
      .get();
    expect(preserved).toEqual({ id: "a1", run_id: "r1", session_id: null });

    const runIdCol = sqlite
      .query<{ name: string; notnull: number }, []>("PRAGMA table_info(articles)")
      .all()
      .find((c) => c.name === "run_id");
    expect(runIdCol?.notnull).toBe(0);

    const indexes = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='articles' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name)
      .sort();
    expect(indexes).toEqual([
      "articles_run_id_idx",
      "articles_run_id_slug_unique",
      "articles_session_id_idx",
      "articles_session_id_slug_unique",
    ]);
  });

  interface SearchRow {
    title: string;
    body: string;
    entity_type: string;
    entity_id: string;
    source_id: string;
  }

  const searchRows = (db: KiriDb, entityType: string): SearchRow[] =>
    db.$client
      .query<SearchRow, [string]>(
        "SELECT title, body, entity_type, entity_id, source_id FROM search_fts WHERE entity_type = ? ORDER BY source_id",
      )
      .all(entityType);

  it("keeps search_fts in step with articles through insert, update, and delete", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-fts",
        workflowName: "digester",
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();
    db.insert(articles)
      .values({
        id: "art-fts",
        runId: "run-fts",
        slug: "digest",
        name: "Daily Digest",
        contentMd: "Pelicans nested on the pier.",
        createdAt: new Date(),
      })
      .run();

    expect(searchRows(db, "article")).toEqual([
      {
        title: "Daily Digest",
        body: "Pelicans nested on the pier.",
        entity_type: "article",
        entity_id: "art-fts",
        source_id: "art-fts",
      },
    ]);

    db.update(articles)
      .set({ contentMd: "Herons replaced them overnight." })
      .where(eq(articles.id, "art-fts"))
      .run();
    const updated = searchRows(db, "article");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.body).toBe("Herons replaced them overnight.");

    db.delete(articles).where(eq(articles.id, "art-fts")).run();
    expect(searchRows(db, "article")).toHaveLength(0);
  });

  it("indexes only the text parts of user/assistant messages", () => {
    migrate(db);

    db.insert(sessions)
      .values({ id: "sess-fts", status: "idle", model: "m", startedAt: new Date() })
      .run();
    db.insert(messages)
      .values({
        id: "msg-fts-a",
        sessionId: "sess-fts",
        index: 0,
        role: "user",
        parts: [
          { type: "text", text: "Find the pelican report" },
          { type: "file", url: "blob:x" },
        ],
        createdAt: new Date(),
      })
      .run();
    db.insert(messages)
      .values({
        id: "msg-fts-b",
        sessionId: "sess-fts",
        index: 1,
        role: "assistant",
        parts: [
          { type: "reasoning", text: "chain of thought" },
          { type: "text", text: "Here it" },
          { type: "text", text: "is." },
        ],
        createdAt: new Date(),
      })
      .run();
    // System messages and messages with no text parts contribute nothing.
    db.insert(messages)
      .values({
        id: "msg-fts-c",
        sessionId: "sess-fts",
        index: 2,
        role: "system",
        parts: [{ type: "text", text: "persona overlay" }],
        createdAt: new Date(),
      })
      .run();
    db.insert(messages)
      .values({
        id: "msg-fts-d",
        sessionId: "sess-fts",
        index: 3,
        role: "assistant",
        parts: [{ type: "tool-run_command", state: "output-available" }],
        createdAt: new Date(),
      })
      .run();

    expect(searchRows(db, "session")).toEqual([
      {
        title: "",
        body: "Find the pelican report",
        entity_type: "session",
        entity_id: "sess-fts",
        source_id: "msg-fts-a",
      },
      {
        title: "",
        body: "Here it is.",
        entity_type: "session",
        entity_id: "sess-fts",
        source_id: "msg-fts-b",
      },
    ]);
  });

  it("re-indexes a message on update and drops it on delete", () => {
    migrate(db);

    db.insert(sessions)
      .values({ id: "sess-upd", status: "idle", model: "m", startedAt: new Date() })
      .run();
    db.insert(messages)
      .values({
        id: "msg-upd",
        sessionId: "sess-upd",
        index: 0,
        role: "assistant",
        parts: [{ type: "text", text: "first draft" }],
        createdAt: new Date(),
      })
      .run();

    db.update(messages)
      .set({ parts: [{ type: "text", text: "second draft" }] })
      .where(eq(messages.id, "msg-upd"))
      .run();
    const updated = searchRows(db, "session");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.body).toBe("second draft");

    db.delete(messages).where(eq(messages.id, "msg-upd")).run();
    expect(searchRows(db, "session")).toHaveLength(0);
  });

  it("indexes a run only while it has a summary", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-sum",
        workflowName: "aggregator",
        status: "running",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();
    expect(searchRows(db, "run")).toHaveLength(0);

    db.update(runs).set({ summary: "Two steps ran cleanly." }).where(eq(runs.id, "run-sum")).run();
    expect(searchRows(db, "run")).toEqual([
      {
        title: "aggregator",
        body: "Two steps ran cleanly.",
        entity_type: "run",
        entity_id: "run-sum",
        source_id: "run-sum",
      },
    ]);

    // The rerun path clears summary on the reused row — the index entry must go with it.
    db.update(runs).set({ summary: null }).where(eq(runs.id, "run-sum")).run();
    expect(searchRows(db, "run")).toHaveLength(0);

    db.update(runs).set({ summary: "Second attempt." }).where(eq(runs.id, "run-sum")).run();
    db.delete(runs).where(eq(runs.id, "run-sum")).run();
    expect(searchRows(db, "run")).toHaveLength(0);
  });

  it("matches stemmed prefix queries against indexed text", () => {
    migrate(db);

    db.insert(sessions)
      .values({ id: "sess-match", status: "idle", model: "m", startedAt: new Date() })
      .run();
    db.insert(articles)
      .values({
        id: "art-match",
        sessionId: "sess-match",
        slug: "digest",
        name: "Digest",
        contentMd: "Pelicans nested on the pier.",
        createdAt: new Date(),
      })
      .run();

    // 'porter unicode61' stems "pelicans" → a "pelican"* prefix query hits it.
    const hits = db.$client
      .query<{ entity_id: string }, [string]>(
        "SELECT entity_id FROM search_fts WHERE search_fts MATCH ? ORDER BY bm25(search_fts)",
      )
      .all('"pelican"*');
    expect(hits).toEqual([{ entity_id: "art-match" }]);
  });

  it("backfills search_fts from existing rows when migrating a pre-search DB", () => {
    const sqlite = db.$client;
    sqlite.run(
      "CREATE TABLE __kiri_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
    );
    // Minimal post-0021 shapes of the three tables 0022's backfill reads,
    // plus sessions, which 0023 alters with the lineage columns.
    sqlite.run(`CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_name TEXT NOT NULL,
      summary TEXT
    )`);
    sqlite.run("CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL)");
    sqlite.run(`CREATE TABLE articles (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      content_md TEXT NOT NULL
    )`);
    sqlite.run(`CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      parts TEXT NOT NULL
    )`);
    const priorMigrations = [
      "0000_initial",
      "0001_index_run_nodes_run_id",
      "0002_rename_run_nodes_to_run_steps",
      "0003_add_run_summary_columns",
      "0004_add_publish_support",
      "0005_add_run_git_columns",
      "0006_drop_step_materials",
      "0007_drop_step_usage",
      "0008_rename_run_artefacts_to_articles",
      "0009_add_run_inputs",
      "0010_add_recommendations",
      "0011_drop_run_trigger",
      "0012_add_run_step_timing",
      "0013_rename_article_columns",
      "0014_add_sessions_and_messages",
      "0015_drop_session_agent_columns",
      "0016_add_session_persona",
      "0017_drop_session_token_totals",
      "0018_rename_is_publish_to_is_article",
      "0019_decouple_articles_from_runs",
      "0020_add_session_pinned",
      "0021_add_session_image_model",
    ];
    sqlite.run(
      `INSERT INTO __kiri_migrations (name, applied_at) VALUES ${priorMigrations
        .map((name) => `('${name}', 0)`)
        .join(", ")}`,
    );
    sqlite.run("INSERT INTO runs VALUES ('r1', 'wf', 'Ran fine.'), ('r2', 'wf', NULL)");
    sqlite.run("INSERT INTO articles VALUES ('a1', 'Digest', 'Old pelican news')");
    sqlite.run(
      `INSERT INTO messages VALUES
        ('m1', 's1', 'user', '[{"type":"text","text":"hello there"}]'),
        ('m2', 's1', 'assistant', '[{"type":"tool-run_command","state":"output-available"}]'),
        ('m3', 's1', 'system', '[{"type":"text","text":"overlay"}]')`,
    );

    migrate(db);

    const rows = sqlite
      .query<{ entity_type: string; entity_id: string; source_id: string; body: string }, []>(
        "SELECT entity_type, entity_id, source_id, body FROM search_fts ORDER BY entity_type, source_id",
      )
      .all();
    expect(rows).toEqual([
      { entity_type: "article", entity_id: "a1", source_id: "a1", body: "Old pelican news" },
      { entity_type: "run", entity_id: "r1", source_id: "r1", body: "Ran fine." },
      { entity_type: "session", entity_id: "s1", source_id: "m1", body: "hello there" },
    ]);
  });
});
