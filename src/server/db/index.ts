import { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type KiriDb = BunSQLiteDatabase<typeof schema> & { $client: Database };

export function openDatabase(path: string): KiriDb {
  const sqlite = new Database(path);
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
