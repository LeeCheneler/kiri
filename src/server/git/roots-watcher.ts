import { type FSWatcher, existsSync, watch } from "node:fs";
import type { EventBus } from "../events/index.ts";

export interface WatchWorktreeRootsOptions {
  debounceMs?: number;
  /** Injection hook for `fs.watch` so tests can drive watcher events deterministically. */
  watchFn?: typeof watch;
  /** Optional event bus. When supplied, the watcher publishes git.changed on any change. */
  bus?: EventBus;
}

export interface WorktreeRootsWatcher {
  stop(): void;
}

// Creating a worktree touches many paths in a burst — the directory appears,
// then env symlinks and an install churn inside it — and the burst is spread
// over more than the milliseconds a single editor save takes. A longer window
// than the config/persona watchers collapses the whole burst into one publish.
const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Watch the configured worktree `roots` — one level deep, non-recursively — and
 * publish `git.changed` whenever a directory under one of them is added,
 * renamed, or removed, so a worktree created or deleted outside kiri shows up
 * without a manual refresh. The event carries no payload: the model is rebuilt
 * from disk per request, so a bare signal is enough.
 *
 * Only the roots themselves are watched, not each repo's internals — a commit or
 * a working-tree edit inside a repo does not signal, and its dirty/ahead state
 * reconciles on the next refresh.
 *
 * A root that doesn't exist is skipped: `fs.watch` cannot attach to a path that
 * doesn't exist, so a root created later needs a restart.
 */
export function watchWorktreeRoots(
  roots: readonly string[],
  options: WatchWorktreeRootsOptions = {},
): WorktreeRootsWatcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchFn = options.watchFn ?? watch;
  const bus = options.bus;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      bus?.publish({ type: "git.changed" });
    }, debounceMs);
  };

  const watchers: FSWatcher[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const fsWatcher = watchFn(root, { persistent: false }, () => schedule());
    // Bun's fs.watch can emit `error` for transient races (a directory removed
    // under the watched root). Without a handler these kill the process. Signal
    // a change anyway — a refetch reconciles the model whether or not the error
    // was real.
    fsWatcher.on("error", (cause) => {
      console.error(
        `git: watcher error on ${root}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      schedule();
    });
    watchers.push(fsWatcher);
  }

  return {
    stop() {
      if (timer !== null) clearTimeout(timer);
      for (const fsWatcher of watchers) fsWatcher.close();
    },
  };
}
