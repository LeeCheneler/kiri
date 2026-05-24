import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "../bootstrap.ts";
import type { KiriDb } from "../db/index.ts";
import { type EventBus, createEventBus } from "../events/index.ts";
import { type Registry, createRegistry } from "../workflows/index.ts";

/** Headers the CSRF gate requires on every state-changing request. */
export const CLIENT_HEADERS = { "X-Kiri-Client": "kiri-ui" };

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

/**
 * Write an executable `scripts/<name>/run.sh` under `cwd` with the given
 * body. Returns the absolute path to the created script.
 */
export function writeBundle(cwd: string, name: string, body: string): string {
  const dir = join(cwd, "scripts", name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "run.sh");
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

/**
 * Build an EventBus paired with a `waitForFinished(runId)` helper that
 * resolves once the run emits its `run.finished` event. Trigger endpoints
 * return 202 the moment the run row exists; tests that assert on terminal
 * state subscribe before triggering and await this signal.
 */
export interface RunWaiter {
  bus: EventBus;
  waitForFinished(runId: string): Promise<void>;
}

export function createRunWaiter(): RunWaiter {
  const bus = createEventBus();
  const finished = new Set<string>();
  const pending = new Map<string, () => void>();
  bus.subscribe((e) => {
    if (e.type !== "run.finished") return;
    finished.add(e.id);
    pending.get(e.id)?.();
    pending.delete(e.id);
  });
  const waitForFinished = (runId: string): Promise<void> => {
    if (finished.has(runId)) return Promise.resolve();
    return new Promise((resolve) => {
      pending.set(runId, resolve);
    });
  };
  return { bus, waitForFinished };
}
