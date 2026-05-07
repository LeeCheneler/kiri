import { type FSWatcher, statSync, watch } from "node:fs";
import { type LoadResult, loadWorkflows } from "./loader.ts";
import type { Registry } from "./registry.ts";

export interface WatchOptions {
  log?: (message: string) => void;
  errorLog?: (message: string, err: unknown) => void;
  debounceMs?: number;
}

export interface WorkflowWatcher {
  stop(): void;
}

const DEFAULT_DEBOUNCE_MS = 50;

interface Snapshot {
  byName: Map<string, { path: string; mtimeMs: number }>;
}

const buildSnapshot = (sources: Map<string, string>): Snapshot => {
  const byName = new Map<string, { path: string; mtimeMs: number }>();
  for (const [name, path] of sources) {
    byName.set(name, { path, mtimeMs: statSync(path).mtimeMs });
  }
  return { byName };
};

/**
 * Watch `dir` for workflow file changes and keep `registry` in sync.
 * Logs `added` / `changed` / `removed` workflow names on each rebuild.
 * Validation or duplicate-name failures are logged via `errorLog`; the
 * registry stays at its last successful state until a later rebuild
 * succeeds.
 *
 * `initial` seeds the watcher's view so the first rebuild only logs
 * actual deltas relative to what the caller already loaded — not every
 * workflow that's already there.
 *
 * fs.watch on macOS fires multiple events per single edit; the debounce
 * collapses bursts into a single rebuild.
 */
export function watchWorkflows(
  dir: string,
  registry: Registry,
  initial: LoadResult,
  options: WatchOptions = {},
): WorkflowWatcher {
  const log = options.log ?? ((message) => console.log(message));
  const errorLog = options.errorLog ?? ((message, err) => console.error(message, err));
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let snapshot = buildSnapshot(initial.sources);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = async () => {
    timer = null;
    try {
      const result = await loadWorkflows(dir);
      const next = buildSnapshot(result.sources);
      for (const [name, info] of next.byName) {
        const prev = snapshot.byName.get(name);
        if (!prev) {
          log(`workflows: added "${name}"`);
        } else if (prev.mtimeMs !== info.mtimeMs) {
          log(`workflows: changed "${name}"`);
        }
      }
      for (const name of snapshot.byName.keys()) {
        if (!next.byName.has(name)) log(`workflows: removed "${name}"`);
      }
      snapshot = next;
      registry.replace(result.workflows);
    } catch (err) {
      errorLog("workflows: failed to reload", err);
    }
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      void rebuild();
    }, debounceMs);
  };

  const fsWatcher: FSWatcher = watch(dir, { persistent: false }, () => schedule());

  return {
    stop() {
      if (timer !== null) clearTimeout(timer);
      fsWatcher.close();
    },
  };
}
