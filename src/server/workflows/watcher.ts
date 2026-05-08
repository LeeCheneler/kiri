import { type FSWatcher, statSync, watch } from "node:fs";
import { type LoadResult, loadWorkflows } from "./loader.ts";
import type { Registry } from "./registry.ts";

export interface WatchOptions {
  debounceMs?: number;
  /** Injection hook for `fs.watch` so tests can drive watcher events deterministically. */
  watchFn?: typeof watch;
}

export interface WorkflowWatcher {
  stop(): void;
}

const DEFAULT_DEBOUNCE_MS = 50;

interface Snapshot {
  byName: Map<string, { path: string; mtimeMs: number }>;
  failingPaths: Set<string>;
}

const buildSnapshot = (result: LoadResult): Snapshot => {
  const byName = new Map<string, { path: string; mtimeMs: number }>();
  for (const [name, path] of result.sources) {
    byName.set(name, { path, mtimeMs: statSync(path).mtimeMs });
  }
  return {
    byName,
    failingPaths: new Set(result.failures.map((f) => f.path)),
  };
};

/**
 * Watch `dir` for workflow file changes and keep `registry` in sync.
 * Logs `added` / `changed` / `removed` workflow names on each rebuild.
 * Per-file load failures are logged the first time a path enters the
 * failure set; recoveries are logged when a previously failing path drops
 * out.
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
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchFn = options.watchFn ?? watch;

  let snapshot = buildSnapshot(initial);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = async () => {
    timer = null;
    let result: LoadResult;
    try {
      result = await loadWorkflows(dir);
    } catch (cause) {
      // Directory disappeared between an fs.watch event and the debounced
      // rebuild — usually a teardown race. Log and bail; if it's transient
      // the next event reschedules a rebuild that succeeds.
      console.error(
        `workflows: rebuild failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return;
    }
    const next = buildSnapshot(result);
    for (const [name, info] of next.byName) {
      const prev = snapshot.byName.get(name);
      if (!prev) {
        console.log(`workflows: added "${name}"`);
      } else if (prev.mtimeMs !== info.mtimeMs) {
        console.log(`workflows: changed "${name}"`);
      }
    }
    for (const name of snapshot.byName.keys()) {
      if (!next.byName.has(name)) console.log(`workflows: removed "${name}"`);
    }
    for (const failure of result.failures) {
      if (!snapshot.failingPaths.has(failure.path)) {
        console.error(`workflows: failed to load ${failure.path}: ${failure.reason}`);
      }
    }
    for (const path of snapshot.failingPaths) {
      if (!next.failingPaths.has(path)) {
        console.log(`workflows: ${path} no longer failing`);
      }
    }
    snapshot = next;
    registry.replace(result.workflows);
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      void rebuild();
    }, debounceMs);
  };

  const fsWatcher: FSWatcher = watchFn(dir, { persistent: false }, () => schedule());

  // Bun's fs.watch on Linux can emit `error` events for transient inotify
  // races (e.g. a file removed under the watched dir). Without a handler
  // these would propagate as unhandled errors and kill the process. Log
  // and schedule a rebuild — if the error is real, the rebuild surfaces
  // it via loadWorkflows; if it's transient, the rebuild reconciles state.
  fsWatcher.on("error", (cause) => {
    console.error(
      `workflows: watcher error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    schedule();
  });

  return {
    stop() {
      if (timer !== null) clearTimeout(timer);
      fsWatcher.close();
    },
  };
}
