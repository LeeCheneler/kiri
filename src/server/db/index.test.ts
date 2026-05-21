import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { type KiriDb, openDatabase } from "./index.ts";
import { migrate } from "./migrate.ts";
import { articles, runSteps, runs } from "./schema.ts";

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
        trigger: "manual",
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

  it("declares articles.run_id → runs.id foreign key", () => {
    const fks = getTableConfig(articles).foreignKeys;
    expect(fks).toHaveLength(1);
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

  it("re-running migrate is a no-op", () => {
    migrate(db);
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-1",
        workflowName: "x",
        status: "ok",
        trigger: "manual",
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
        trigger: "manual",
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
        trigger: "manual",
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
        trigger: "manual",
        startedAt: new Date(1_700_000_000_000),
        definitionSnapshot: { name: "digester", steps: [] },
      })
      .run();

    const createdAt = new Date(1_700_000_005_000);
    db.insert(articles)
      .values({
        id: "art-1",
        runId: "run-art",
        name: "digest",
        title: "Digest",
        contentMd: "# Top story\n\nA thing happened.",
        createdAt,
      })
      .run();

    const row = db.select().from(articles).where(eq(articles.id, "art-1")).get();
    expect(row).toBeDefined();
    expect(row?.runId).toBe("run-art");
    expect(row?.name).toBe("digest");
    expect(row?.title).toBe("Digest");
    expect(row?.contentMd).toBe("# Top story\n\nA thing happened.");
    expect(row?.createdAt).toEqual(createdAt);
  });

  it("enforces (run_id, name) uniqueness on articles", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-uniq",
        workflowName: "x",
        status: "ok",
        trigger: "manual",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();

    db.insert(articles)
      .values({
        id: "art-a",
        runId: "run-uniq",
        name: "digest",
        title: "Digest",
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
          name: "digest",
          title: "Other",
          contentMd: "b",
          createdAt: new Date(),
        })
        .run(),
    ).toThrow();
  });

  it("allows the same article name across different runs", () => {
    migrate(db);

    for (const runId of ["run-x", "run-y"] as const) {
      db.insert(runs)
        .values({
          id: runId,
          workflowName: "x",
          status: "ok",
          trigger: "manual",
          startedAt: new Date(),
          definitionSnapshot: {},
        })
        .run();
      db.insert(articles)
        .values({
          id: `${runId}-digest`,
          runId,
          name: "digest",
          title: "Digest",
          contentMd: "ok",
          createdAt: new Date(),
        })
        .run();
    }

    const rows = db.select().from(articles).all();
    expect(rows).toHaveLength(2);
  });

  it("round-trips run_steps.is_publish", () => {
    migrate(db);

    db.insert(runs)
      .values({
        id: "run-pub",
        workflowName: "x",
        status: "ok",
        trigger: "manual",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();

    db.insert(runSteps)
      .values({
        id: "pub-step-1",
        runId: "run-pub",
        index: 0,
        kind: "use",
        status: "ok",
        isPublish: true,
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

    const publishRow = db.select().from(runSteps).where(eq(runSteps.id, "pub-step-1")).get();
    expect(publishRow?.isPublish).toBe(true);
    expect(publishRow?.isSummary).toBe(false);

    const regularRow = db.select().from(runSteps).where(eq(runSteps.id, "regular-step-1")).get();
    expect(regularRow?.isPublish).toBe(false);
  });

  it("adds is_publish + articles when migrating a pre-publish DB", () => {
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
    expect(stepCols).toContain("is_publish");

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
    expect(indexes).toEqual(["articles_run_id_idx", "articles_run_id_name_unique"]);
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
});
