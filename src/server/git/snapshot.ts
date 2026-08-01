import type { ConfigStore } from "../config/store.ts";
import type { EventBus } from "../events/index.ts";
import { type GitOverview, gitOverview } from "./overview.ts";
import { type WatchWorktreeRootsOptions, watchWorktreeRoots } from "./roots-watcher.ts";

/** The git overview plus how fresh it is. */
export interface GitSnapshot extends GitOverview {
  /**
   * Whether a scan is in flight. The roots and repos alongside it are the last
   * completed scan's, so a reader can say the view is being brought up to date
   * without waiting for it.
   */
  refreshing: boolean;
  /** ISO time the last scan completed, or null before the first one has. */
  scannedAt: string | null;
}

/** The server-held overview: read instantly, refreshed in the background. */
export interface GitSnapshotStore {
  /** The last completed scan, or the empty snapshot before the first lands. Never blocks. */
  current(): GitSnapshot;
  /** Rescan, resolving with the snapshot the scan produced. */
  refresh(): Promise<GitSnapshot>;
  /** Stop following the roots. In-flight scans still settle. */
  stop(): void;
}

export interface CreateGitSnapshotOptions extends WatchWorktreeRootsOptions {
  /** Injection hook for the scan so tests can drive it deterministically. */
  scan?: (roots: readonly string[]) => Promise<GitOverview>;
}

const EMPTY: GitSnapshot = { roots: [], repos: [], refreshing: true, scannedAt: null };

/**
 * Hold the git overview in memory and keep it current, so reads never touch the
 * config, git, or the disk. The snapshot is scanned once at creation and
 * rescanned whenever the roots watcher reports activity, the roots are
 * re-resolved after a `kiri.yaml` edit, or a caller asks for a refresh after a
 * mutation.
 *
 * `git.changed` publishes when a scan *completes*, and only from here: the
 * watcher signals inward rather than announcing to clients, so a change is never
 * announced before the snapshot reflects it. The watcher also owns root
 * resolution — the scan runs against whatever roots it currently has armed.
 *
 * Scans are single-flight. A refresh asked for while one is running does not
 * start a second alongside it; it marks the running scan as superseded, so
 * exactly one more scan follows it however many refreshes arrived. That trailing
 * scan matters: a mutation that landed mid-scan would otherwise be invisible
 * until the next unrelated signal.
 *
 * The snapshot is authoritative about nothing. A watcher misses whatever it
 * cannot see — a commit made in a terminal churns `.git` internals no root watch
 * covers — so `refresh` stays the manual escape hatch, and readers are told how
 * old the model is rather than being sold it as the truth.
 */
export function createGitSnapshot(
  config: ConfigStore,
  env: Record<string, string | undefined>,
  options: CreateGitSnapshotOptions = {},
): GitSnapshotStore {
  const { scan = gitOverview, bus, ...watchOptions } = options;

  let snapshot: GitSnapshot = EMPTY;
  let running: Promise<GitSnapshot> | null = null;
  let superseded = false;

  const runScan = async (): Promise<GitSnapshot> => {
    try {
      do {
        superseded = false;
        const overview = await scan(watcher.roots());
        // Reading `superseded` after the await folds every refresh that arrived
        // during the scan into a single follow-up pass.
        snapshot = { ...overview, refreshing: superseded, scannedAt: new Date().toISOString() };
        bus?.publish({ type: "git.changed" });
      } while (superseded);
      return snapshot;
    } finally {
      // Cleared here rather than off the returned promise, so no observer can
      // ever see a settled snapshot while the store still counts as scanning.
      running = null;
      // A scan that threw must not leave the snapshot pinned to "refreshing".
      snapshot = { ...snapshot, refreshing: false };
    }
  };

  const refresh = (): Promise<GitSnapshot> => {
    if (running !== null) {
      superseded = true;
      return running;
    }
    snapshot = { ...snapshot, refreshing: true };
    running = runScan();
    return running;
  };

  // The watcher's signals have no caller to reject to, so a failed scan is
  // reported and the last good snapshot kept.
  const refreshInBackground = () => {
    void refresh().catch((error: unknown) => {
      console.error(`git: refresh failed: ${error instanceof Error ? error.message : error}`);
    });
  };

  const watcher = watchWorktreeRoots(config, env, {
    ...watchOptions,
    bus,
    onChanged: refreshInBackground,
  });

  refreshInBackground();

  return {
    current: () => snapshot,
    refresh,
    stop: () => watcher.stop(),
  };
}
