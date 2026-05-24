import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "../bootstrap.ts";
import type { KiriDb } from "../db/index.ts";
import { type Registry, createRegistry } from "../workflows/index.ts";

/**
 * One-stop test fixture for the HTTP route suites. Creates a fresh
 * scratch repo (with a bootstrapped SQLite DB and an empty registry),
 * and returns a `dispose` to tear them down between tests.
 */
export interface TestEnv {
  cwd: string;
  db: KiriDb;
  registry: Registry;
  dispose(): void;
}

export function createTestEnv(): TestEnv {
  const cwd = mkdtempSync(join(tmpdir(), "kiri-app-"));
  const db = bootstrap(cwd);
  const registry = createRegistry();
  return {
    cwd,
    db,
    registry,
    dispose() {
      db.$client.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}
