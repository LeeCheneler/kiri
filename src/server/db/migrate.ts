import migration0000 from "../../../drizzle/0000_initial.sql" with { type: "text" };
import migration0001 from "../../../drizzle/0001_index_run_nodes_run_id.sql" with { type: "text" };
import migration0002 from "../../../drizzle/0002_rename_run_nodes_to_run_steps.sql" with {
  type: "text",
};
import migration0003 from "../../../drizzle/0003_add_run_summary_columns.sql" with { type: "text" };
import migration0004 from "../../../drizzle/0004_add_publish_support.sql" with { type: "text" };
import migration0005 from "../../../drizzle/0005_add_run_git_columns.sql" with { type: "text" };
import migration0006 from "../../../drizzle/0006_drop_step_materials.sql" with { type: "text" };
import migration0007 from "../../../drizzle/0007_drop_step_usage.sql" with { type: "text" };
import migration0008 from "../../../drizzle/0008_rename_run_artefacts_to_articles.sql" with {
  type: "text",
};
import migration0009 from "../../../drizzle/0009_add_run_inputs.sql" with { type: "text" };
import migration0010 from "../../../drizzle/0010_add_recommendations.sql" with { type: "text" };
import type { KiriDb } from "./index.ts";

interface Migration {
  name: string;
  sql: string;
}

/**
 * Append-only list of migrations applied at startup, in order. To add a
 * new migration: edit the schema, run `bun db:generate` to produce the
 * SQL file under `drizzle/`, then add a corresponding text import above
 * and an entry here. Names are matched exactly against `__kiri_migrations`
 * — don't rename existing entries after they've shipped.
 *
 * `0002_rename_run_nodes_to_run_steps` and
 * `0008_rename_run_artefacts_to_articles`, plus their meta snapshots,
 * were hand-written: drizzle-kit's rename-detection prompt is
 * interactive-only. The next auto-generated migration may need its
 * `prevId` adjusted to chain off `drizzle/meta/0008_snapshot.json`.
 */
const MIGRATIONS: Migration[] = [
  { name: "0000_initial", sql: migration0000 },
  { name: "0001_index_run_nodes_run_id", sql: migration0001 },
  { name: "0002_rename_run_nodes_to_run_steps", sql: migration0002 },
  { name: "0003_add_run_summary_columns", sql: migration0003 },
  { name: "0004_add_publish_support", sql: migration0004 },
  { name: "0005_add_run_git_columns", sql: migration0005 },
  { name: "0006_drop_step_materials", sql: migration0006 },
  { name: "0007_drop_step_usage", sql: migration0007 },
  { name: "0008_rename_run_artefacts_to_articles", sql: migration0008 },
  { name: "0009_add_run_inputs", sql: migration0009 },
  { name: "0010_add_recommendations", sql: migration0010 },
];

/**
 * Apply any unapplied migrations to `db`. Idempotent: applied migrations
 * are tracked by name in `__kiri_migrations` and skipped on re-run.
 *
 * Migration SQL is bundled into the binary via Bun text imports (see the
 * imports above) so this works inside `bun build --compile` artifacts
 * where no filesystem `drizzle/` folder exists.
 */
export function migrate(db: KiriDb): void {
  const sqlite = db.$client;
  sqlite.run(
    "CREATE TABLE IF NOT EXISTS __kiri_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    sqlite
      .query<{ name: string }, []>("SELECT name FROM __kiri_migrations")
      .all()
      .map((r) => r.name),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    // drizzle-kit emits `--> statement-breakpoint` between statements;
    // bun:sqlite's `.run()` is single-statement, so split and run each.
    // Assumes the marker only appears as drizzle-kit's separator — if a
    // future migration includes it as a string literal or comment, switch
    // to a SQL-aware splitter.
    const statements = migration.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    sqlite.transaction(() => {
      for (const statement of statements) {
        sqlite.run(statement);
      }
      sqlite
        .prepare("INSERT INTO __kiri_migrations (name, applied_at) VALUES (?, ?)")
        .run(migration.name, Date.now());
    })();
  }
}
