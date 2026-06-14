import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { writeLlmProvidersSchemaFile, writeSchemaFile } from "./init.ts";
import { reconcileInterruptedRuns, reconcileInterruptedSessions } from "./reconcile.ts";

/**
 * Prepare `cwd` for kiri: scaffold `workflows/` and `.kiri/` if missing,
 * (re)write `.kiri/workflow.schema.json` and `.kiri/llm-providers.schema.json`
 * from the live Zod schemas so editor validation stays in sync after a binary
 * upgrade, open and migrate the state database, then reconcile any in-flight
 * `runs`/`run_steps` and `sessions` left over from a prior process that died
 * mid-run or mid-turn. Idempotent — safe to call on every launch.
 */
export function bootstrap(cwd: string): KiriDb {
  mkdirSync(join(cwd, "workflows"), { recursive: true });
  const dataDir = join(cwd, ".kiri");
  mkdirSync(dataDir, { recursive: true });
  writeSchemaFile(cwd);
  writeLlmProvidersSchemaFile(cwd);

  const db = openDatabase(join(dataDir, "state.db"));
  migrate(db);
  reconcileInterruptedRuns(db);
  reconcileInterruptedSessions(db);
  return db;
}
