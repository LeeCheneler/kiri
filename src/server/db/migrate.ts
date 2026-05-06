import migration0000 from "../../../drizzle/0000_initial.sql" with { type: "text" };
import migration0001 from "../../../drizzle/0001_index_run_nodes_run_id.sql" with { type: "text" };
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
 */
const MIGRATIONS: Migration[] = [
  { name: "0000_initial", sql: migration0000 },
  { name: "0001_index_run_nodes_run_id", sql: migration0001 },
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
