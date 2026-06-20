import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ConfigStore } from "./config/store.ts";
import { type KiriDb, openDatabase } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { writeDefaultConfig, writeKiriConfigSchemaFile, writeSchemaFile } from "./init.ts";
import { reconcileInterruptedRuns, reconcileInterruptedSessions } from "./reconcile.ts";

/**
 * Prepare the workspace for kiri: scaffold `workflows/`, `.kiri/`, and a
 * commented `kiri.yaml` if missing, (re)write `.kiri/workflow.schema.json` and
 * `.kiri/kiri.schema.json` from the live Zod schemas so editor
 * validation stays in sync after a binary upgrade, open and migrate the state
 * database, then reconcile any in-flight `runs`/`run_steps` and `sessions`
 * left over from a prior process that died mid-run or mid-turn. Idempotent —
 * safe to call on every launch.
 */
export function bootstrap(config: ConfigStore): KiriDb {
  mkdirSync(config.workflowsDir(), { recursive: true });
  const dataDir = config.dataDir();
  mkdirSync(dataDir, { recursive: true });
  writeSchemaFile(config);
  writeKiriConfigSchemaFile(config);
  writeDefaultConfig(config);

  const db = openDatabase(join(dataDir, "state.db"));
  migrate(db);
  reconcileInterruptedRuns(db);
  reconcileInterruptedSessions(db);
  return db;
}
