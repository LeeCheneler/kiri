import { type FSWatcher, watch } from "node:fs";
import { basename } from "node:path";
import type { LlmProviderRegistry } from "../llm/index.ts";
import { loadKiriConfig } from "./loader.ts";
import type { ConfigStore } from "./store.ts";

export interface WatchConfigOptions {
  debounceMs?: number;
  /** Injection hook for `fs.watch` so tests can drive watcher events deterministically. */
  watchFn?: typeof watch;
  /** Called after a successful reload swaps the registry, so dependents (workflow `llm:` validation) can re-run. */
  onReload?: () => void;
}

export interface KiriConfigWatcher {
  stop(): void;
}

const DEFAULT_DEBOUNCE_MS = 50;

/**
 * Watch the workspace's `kiri.yaml` / `kiri.yml` for changes and keep the LLM
 * provider `registry` in sync — the same hot-reload `workflows/` already has. On
 * a successful reload the registry is swapped and `onReload` fires (the boot
 * path wires this to the workflow watcher's `revalidate`, so `llm:` steps
 * re-check their provider against the new set). A reload that fails to parse or
 * validate is logged and the last-known-good registry is kept, so a mid-edit
 * typo never wipes a working provider out from under an in-flight session.
 *
 * Watches the workspace root (filtered to the config file names) rather than a
 * single inode, so an editor's atomic rename-on-save is still observed and a
 * newly-created config file is picked up.
 */
export function watchKiriConfig(
  config: ConfigStore,
  registry: LlmProviderRegistry,
  env: Record<string, string | undefined>,
  options: WatchConfigOptions = {},
): KiriConfigWatcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchFn = options.watchFn ?? watch;
  const onReload = options.onReload;
  const configNames = new Set(config.configFiles().map((path) => basename(path)));
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reload = () => {
    timer = null;
    const result = loadKiriConfig(config, env);
    if (result.warning) console.warn(`kiri.yaml: ${result.warning}`);
    if (result.failure) {
      // Keep the last-known-good registry on an invalid edit; just surface why.
      console.error(`kiri.yaml: failed to load ${result.failure.path}: ${result.failure.reason}`);
      return;
    }
    registry.replace(result.providers);
    console.log(`kiri.yaml: reloaded ${result.providers.size} provider(s)`);
    onReload?.();
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(reload, debounceMs);
  };

  const fsWatcher: FSWatcher = watchFn(config.cwd(), { persistent: false }, (_event, filename) => {
    // The workspace root churns (kiri.md, .env, README); only react to the
    // config file. A null filename — some platforms omit it — is treated
    // conservatively as a possible config change.
    if (filename === null || configNames.has(filename as string)) schedule();
  });

  fsWatcher.on("error", (cause) => {
    console.error(
      `kiri.yaml: watcher error: ${cause instanceof Error ? cause.message : String(cause)}`,
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
