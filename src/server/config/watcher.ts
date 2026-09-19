import { type FSWatcher, watch } from "node:fs";
import { basename } from "node:path";
import type { EventBus } from "../events/index.ts";
import type { LlmProviderRegistry } from "../llm/index.ts";
import { createLogger } from "../log.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import type { ConfigService } from "./service.ts";
import type { ConfigStore } from "./store.ts";

const log = createLogger("config");

export interface WatchConfigOptions {
  debounceMs?: number;
  /** Injection hook for `fs.watch` so tests can drive watcher events deterministically. */
  watchFn?: typeof watch;
  /** Called after a successful reload swaps the registry, so dependents (workflow `llm:` validation) can re-run. */
  onReload?: () => void;
  /** Publishes `config.changed` on the latest settled reload (success or failure) so live clients refetch config-derived state. */
  bus?: EventBus;
  /** When supplied, a successful reload also reconnects the MCP servers in the new config. */
  mcpRegistry?: McpRegistry;
}

export interface KiriConfigWatcher {
  stop(): void;
}

const DEFAULT_DEBOUNCE_MS = 50;

/**
 * Watch the workspace's `kiri.yaml` / `kiri.yml` for changes and keep the LLM
 * provider `registry` — and, when supplied, the MCP server `mcpRegistry` — in
 * sync with `service`'s current snapshot, the same hot-reload `workflows/`
 * already has. The watcher parses nothing itself: the service owns the config,
 * and a change is only the cue to apply its snapshot to the registries. On a successful reload the
 * provider registry is swapped and `onReload` fires before MCP reconnection
 * finishes, so workflows can re-check their providers without waiting for tools.
 * A reload that fails to parse or validate is logged and the last-known-good registry is kept, so a mid-edit
 * typo never wipes a working provider out from under an in-flight session.
 * The latest settled reload — success or failure — publishes `config.changed` on
 * `bus`, so live clients refetch config-derived state (including a newly
 * introduced error, not just a successful swap). Superseded completions and
 * completions after stop do not notify dependents.
 *
 * Watches the workspace root (filtered to the config file names) rather than a
 * single inode, so an editor's atomic rename-on-save is still observed and a
 * newly-created config file is picked up.
 */
export function watchKiriConfig(
  config: ConfigStore,
  service: ConfigService,
  registry: LlmProviderRegistry,
  env: Record<string, string | undefined>,
  options: WatchConfigOptions = {},
): KiriConfigWatcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchFn = options.watchFn ?? watch;
  const onReload = options.onReload;
  const bus = options.bus;
  const mcpRegistry = options.mcpRegistry;
  const configNames = new Set(config.configFiles().map((path) => basename(path)));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;
  let stopped = false;

  const reload = async (requested: number) => {
    timer = null;
    if (stopped) return;
    const result = service.current();
    const { failure, warning } = result.diagnostics;
    if (warning) log.warn(`kiri.yaml: ${warning}`);
    if (failure) {
      // Keep the last-known-good registries on an invalid edit; just surface why.
      log.error(`kiri.yaml: failed to load ${failure.path}: ${failure.reason}`);
    } else {
      registry.replace(result.providers);
      log.info(`kiri.yaml: reloaded ${result.providers.size} provider(s)`);
      // Provider validation must not wait for MCP discovery, which can be slow.
      onReload?.();
      if (mcpRegistry) {
        await mcpRegistry.replace(result.mcp, env);
        if (stopped || requested !== revision) return;
        log.info(`kiri.yaml: reloaded ${result.mcp.size} mcp server(s)`);
      }
    }
    // Notify live clients on the latest settled reload — including a failure — so the
    // in-app config-health panel reflects a newly introduced error too.
    bus?.publish({ type: "config.changed" });
  };

  const schedule = () => {
    if (stopped) return;
    const requested = ++revision;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void reload(requested), debounceMs);
  };

  const fsWatcher: FSWatcher = watchFn(config.cwd(), { persistent: false }, (_event, filename) => {
    // The workspace root churns (kiri.md, .env, README); only react to the
    // config file. A null filename — some platforms omit it — is treated
    // conservatively as a possible config change.
    if (filename === null || configNames.has(filename as string)) schedule();
  });

  fsWatcher.on("error", (cause) => {
    log.error(
      `kiri.yaml: watcher error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    schedule();
  });

  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      fsWatcher.close();
    },
  };
}
