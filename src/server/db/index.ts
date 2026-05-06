import { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

/**
 * Drizzle-wrapped SQLite handle for kiri's state DB.
 *
 * `$client` is drizzle's own runtime escape hatch for the underlying
 * bun:sqlite `Database`. The intersection here re-establishes it on
 * the type because `BunSQLiteDatabase<TSchema>` alone doesn't include
 * it — `drizzle(...)`'s return type adds it, and we recover that when
 * we widen via this alias. Used by the migrator and `.close()`.
 */
export type KiriDb = BunSQLiteDatabase<typeof schema> & { $client: Database };

/**
 * Open a kiri state database at `path`, enabling WAL journaling and
 * per-connection foreign-key enforcement (SQLite's default is FKs off).
 * Returns a drizzle handle ready for queries; pass it to `migrate` to
 * apply schema migrations.
 */
export function openDatabase(path: string): KiriDb {
  const sqlite = new Database(path);
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
