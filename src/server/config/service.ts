import { statSync } from "node:fs";
import type { LlmProvider } from "../llm/schema.ts";
import type { McpServer, McpServerUnresolved } from "../mcp/schema.ts";
import { type KiriConfigLoadFailure, type KiriConfigLoadResult, loadKiriConfig } from "./loader.ts";
import type { ModelsConfig } from "./schema.ts";
import type { ConfigStore } from "./store.ts";

/**
 * The effective `kiri.yaml` configuration at one moment: every section from
 * the same load, so settings read together agree with each other. Immutable —
 * an edit produces a new snapshot with a higher `revision`.
 *
 * An invalid edit affects the sections differently, deliberately. Connectivity
 * — `providers`, `mcp`, and the `models` that name them — keeps its last good
 * value, so a mid-edit typo never takes a working provider, or the shortcuts
 * and delegates pointing at it, out from under a running session. `filesystem`
 * fails closed: no directory stays reachable on the strength of a file that no
 * longer says so. `diagnostics` always describes the latest load, so a newly
 * introduced error is visible while the last good connectivity is still being
 * served.
 */
export interface ConfigSnapshot {
  /** Advances on every load, so holders can tell whether they have seen this snapshot. */
  readonly revision: number;
  /** LLM providers keyed by name. Last good on a failed load. */
  readonly providers: ReadonlyMap<string, LlmProvider>;
  /** MCP servers keyed by name whose declared env refs all resolve. Last good on a failed load. */
  readonly mcp: ReadonlyMap<string, McpServer>;
  /** Model shortcuts, delegates, and the utility and transcription models. Last good on a failed load. */
  readonly models: ModelsConfig;
  /** The session filesystem sandbox. Empty — tools withheld — on a failed load. */
  readonly filesystem: {
    /** Absolute directories the session filesystem and shell tools are confined to. */
    readonly allowedDirectories: readonly string[];
    /** Absolute directory new sessions start in; absent when the sandbox is empty. */
    readonly defaultWorkingDirectory?: string;
  };
  /** What the latest load reported, whether or not it succeeded. */
  readonly diagnostics: {
    /** Set when a present file failed to load. An absent file is not a failure. */
    readonly failure?: KiriConfigLoadFailure;
    /** Non-fatal note, e.g. both `kiri.yaml` and `kiri.yml` exist. */
    readonly warning?: string;
    /** MCP servers excluded because a declared env ref names an unset variable. */
    readonly mcpUnresolved: readonly McpServerUnresolved[];
  };
}

/** The single owner of the workspace's parsed `kiri.yaml`. */
export interface ConfigService {
  /**
   * The effective configuration now. Checks the config files' modification
   * stamps and loads again only when they changed, so it is cheap to call at
   * every point of use and never serves a snapshot older than the file on disk.
   */
  current(): ConfigSnapshot;
  /** Load again regardless of the files' stamps, returning the new snapshot. */
  reload(): ConfigSnapshot;
}

// A change detector for the candidate config files that needs no file contents:
// nanosecond modification time plus size, or the file's absence.
const stampOf = (paths: readonly string[]): string =>
  paths
    .map((path) => {
      const stat = statSync(path, { bigint: true, throwIfNoEntry: false });
      return stat ? `${stat.mtimeNs}:${stat.size}` : "absent";
    })
    .join("|");

function snapshotOf(
  revision: number,
  result: KiriConfigLoadResult,
  previous: ConfigSnapshot | undefined,
): ConfigSnapshot {
  // A failed load carries empty sections; connectivity falls back to the last
  // good snapshot while the filesystem takes the empty, fail-closed value.
  const connectivity = result.failure && previous ? previous : result;
  return Object.freeze({
    revision,
    providers: connectivity.providers,
    mcp: connectivity.mcp,
    models: Object.freeze(connectivity.models),
    filesystem: Object.freeze({
      allowedDirectories: Object.freeze(result.allowedDirectories),
      ...(result.defaultWorkingDirectory !== undefined
        ? { defaultWorkingDirectory: result.defaultWorkingDirectory }
        : {}),
    }),
    diagnostics: Object.freeze({
      ...(result.failure ? { failure: result.failure } : {}),
      ...(result.warning !== undefined ? { warning: result.warning } : {}),
      mcpUnresolved: Object.freeze(result.mcpUnresolved),
    }),
  });
}

/**
 * Build the {@link ConfigService} for a workspace, loading its config once up
 * front. `env` is what declared `{ env: }` refs are checked against.
 */
export function createConfigService(
  config: ConfigStore,
  env: Record<string, string | undefined>,
): ConfigService {
  // Stamp before reading, here and on every load: an edit landing mid-load
  // leaves a stale stamp behind, so the next read loads again rather than
  // missing it.
  let stamp = stampOf(config.configFiles());
  let snapshot = snapshotOf(1, loadKiriConfig(config, env), undefined);

  const load = (): ConfigSnapshot => {
    stamp = stampOf(config.configFiles());
    snapshot = snapshotOf(snapshot.revision + 1, loadKiriConfig(config, env), snapshot);
    return snapshot;
  };

  return {
    current: () => (stampOf(config.configFiles()) === stamp ? snapshot : load()),
    reload: load,
  };
}
