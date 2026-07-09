import { type FSWatcher, existsSync, watch } from "node:fs";
import type { ConfigStore } from "../config/store.ts";
import type { EventBus } from "../events/index.ts";

export interface WatchPersonasOptions {
  debounceMs?: number;
  /** Injection hook for `fs.watch` so tests can drive watcher events deterministically. */
  watchFn?: typeof watch;
  /** Optional event bus. When supplied, the watcher publishes persona.changed on any change. */
  bus?: EventBus;
}

export interface PersonaWatcher {
  stop(): void;
}

const DEFAULT_DEBOUNCE_MS = 50;

/**
 * Watch the workspace's `personas/` directory and publish `persona.changed`
 * whenever a persona file is added, edited, or removed, so the session's
 * persona picker refetches. The event carries no payload — the list is read
 * fresh from disk per request, so a bare signal is enough.
 *
 * A missing `personas/` directory is a no-op: `fs.watch` cannot attach to a
 * path that doesn't exist, so a directory created later needs a restart.
 *
 * fs.watch on macOS fires multiple events per single edit; the debounce
 * collapses bursts into a single publish.
 */
export function watchPersonas(
  config: ConfigStore,
  options: WatchPersonasOptions = {},
): PersonaWatcher {
  const dir = config.personasDir();
  if (!existsSync(dir)) return { stop() {} };

  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchFn = options.watchFn ?? watch;
  const bus = options.bus;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      bus?.publish({ type: "persona.changed" });
    }, debounceMs);
  };

  const fsWatcher: FSWatcher = watchFn(dir, { persistent: false }, () => schedule());

  // Bun's fs.watch can emit `error` for transient races (a file removed under
  // the watched dir). Without a handler these kill the process. Signal a change
  // anyway — a refetch reconciles the list whether or not the error was real.
  fsWatcher.on("error", (cause) => {
    console.error(
      `personas: watcher error: ${cause instanceof Error ? cause.message : String(cause)}`,
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
