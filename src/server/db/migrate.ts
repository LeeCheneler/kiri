import migration0000 from "../../../drizzle/0000_initial.sql" with { type: "text" };
import type { KiriDb } from "./index.ts";

interface Migration {
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [{ name: "0000_initial", sql: migration0000 }];

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
