import { type FSWatcher, existsSync, watch } from "node:fs";
import { loadKiriConfig } from "../config/loader.ts";
import type { ConfigStore } from "../config/store.ts";
import type { EventBus } from "../events/index.ts";
import { resolveWorktreeRoots } from "./config.ts";

export interface WatchWorktreeRootsOptions {
  debounceMs?: number;
  /** Injection hook for `fs.watch` so tests can drive watcher events deterministically. */
  watchFn?: typeof watch;
  /** Optional event bus. When supplied, the watcher publishes git.changed on any change and re-resolves its roots on config.changed. */
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

const sameRoots = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((root, index) => root === b[index]);

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
 * The roots come from `config`'s `git:` section, re-read on every
 * `config.changed`, so adding or removing one in `kiri.yaml` takes effect
 * without a restart: when the set differs the current watchers are torn down,
 * new ones armed over the new set, and `git.changed` published so open pages
 * pick up the new shape. A config that is present but fails to load keeps the
 * current roots — a syntax error mid-edit must not blank the view — whereas a
 * clean load with no `git:` section clears them, since removing the section is
 * deliberate.
 *
 * A root that doesn't exist is skipped: `fs.watch` cannot attach to a path that
 * doesn't exist, so a root created later is picked up on the next config change.
 */
export function watchWorktreeRoots(
  config: ConfigStore,
  env: Record<string, string | undefined>,
  options: WatchWorktreeRootsOptions = {},
): WorktreeRootsWatcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchFn = options.watchFn ?? watch;
  const bus = options.bus;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let watchers: FSWatcher[] = [];
  let roots: readonly string[] = [];

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      bus?.publish({ type: "git.changed" });
    }, debounceMs);
  };

  const arm = (next: readonly string[]) => {
    roots = next;
    for (const root of next) {
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
  };

  const disarm = () => {
    for (const fsWatcher of watchers) fsWatcher.close();
    watchers = [];
  };

  // null means "keep what's armed": the file is there but unreadable, so its
  // roots are unknown rather than gone.
  const resolveRoots = (): string[] | null => {
    const result = loadKiriConfig(config, env);
    return result.failure ? null : resolveWorktreeRoots(result.git, config.cwd());
  };

  arm(resolveRoots() ?? []);

  const unsubscribe = bus?.subscribe((event) => {
    if (event.type !== "config.changed") return;
    const next = resolveRoots();
    if (next === null || sameRoots(roots, next)) return;
    disarm();
    arm(next);
    bus.publish({ type: "git.changed" });
  });

  return {
    stop() {
      if (timer !== null) clearTimeout(timer);
      unsubscribe?.();
      disarm();
    },
  };
}
