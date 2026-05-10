/**
 * Process-local registry tracking the in-flight child process for each
 * active run so the HTTP cancel handler can stop it. Entries live for
 * the duration of a run: `register` at start, `setChild` each time a
 * step spawns, `release` at the run's terminal transition.
 *
 * Cancel is two-phase: SIGTERM first, then SIGKILL after a grace
 * period if the child is still alive. The runner reads `isCancelled`
 * between steps so a cancel that arrives after the active step exits
 * still halts the workflow before the next step starts.
 */
/** Minimal shape needed to stop a child — matches `Bun.Subprocess.kill`. */
export interface ChildHandle {
  kill(signal?: NodeJS.Signals | number): void;
}

export interface CancelRegistry {
  /** Mark `runId` as in-flight. Must be called synchronously at run start so the cancel HTTP handler never observes a window where the run is `running` in the DB but unknown to the registry. */
  register(runId: string): void;
  /** Publish the active step's child process. If cancel was already requested, the child is signalled immediately. */
  setChild(runId: string, child: ChildHandle): void;
  /** Send the cancel signal. Returns `true` if the run was registered (the caller can map this to 202); `false` if unknown. Idempotent. */
  requestCancel(runId: string): boolean;
  /** Clear the entry and any pending SIGKILL timer. Call once when the run reaches a terminal state. */
  release(runId: string): void;
  /** True once `requestCancel` has been called for `runId`. Used by the runner to halt between steps. */
  isCancelled(runId: string): boolean;
}

export interface CancelRegistryOptions {
  /** Grace period between SIGTERM and SIGKILL. Defaults to 2000ms; tests pass a smaller value. */
  sigkillDelayMs?: number;
}

interface Entry {
  cancelled: boolean;
  child?: ChildHandle;
  killTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_SIGKILL_DELAY_MS = 2000;

const armKillTimer = (entry: Entry, child: ChildHandle, delayMs: number): void => {
  child.kill("SIGTERM");
  entry.killTimer = setTimeout(() => {
    child.kill("SIGKILL");
  }, delayMs);
};

/**
 * Build a fresh cancel registry. State is private to the returned
 * object — kiri creates one at boot and threads it through to the
 * runner and the HTTP handler.
 */
export function createCancelRegistry(opts: CancelRegistryOptions = {}): CancelRegistry {
  const { sigkillDelayMs = DEFAULT_SIGKILL_DELAY_MS } = opts;
  const entries = new Map<string, Entry>();

  return {
    register(runId) {
      entries.set(runId, { cancelled: false });
    },

    setChild(runId, child) {
      const entry = entries.get(runId);
      if (!entry) return;
      entry.child = child;
      // Cancel may have arrived in the gap between the runner's pre-step
      // `isCancelled` check and this spawn; signal the new child right away.
      if (entry.cancelled) armKillTimer(entry, child, sigkillDelayMs);
    },

    requestCancel(runId) {
      const entry = entries.get(runId);
      if (!entry) return false;
      if (entry.cancelled) return true;
      entry.cancelled = true;
      if (entry.child) armKillTimer(entry, entry.child, sigkillDelayMs);
      return true;
    },

    release(runId) {
      const entry = entries.get(runId);
      if (!entry) return;
      if (entry.killTimer) clearTimeout(entry.killTimer);
      entries.delete(runId);
    },

    isCancelled(runId) {
      return entries.get(runId)?.cancelled ?? false;
    },
  };
}
