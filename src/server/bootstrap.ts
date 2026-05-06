import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";

/**
 * Prepare `cwd` for kiri: scaffold `workflows/` and `.kiri/` if missing,
 * then open and migrate the state database. Idempotent — safe to call on
 * every launch.
 */
export function bootstrap(cwd: string): KiriDb {
  mkdirSync(join(cwd, "workflows"), { recursive: true });
  const dataDir = join(cwd, ".kiri");
  mkdirSync(dataDir, { recursive: true });

  const db = openDatabase(join(dataDir, "state.db"));
  migrate(db);
  return db;
}
