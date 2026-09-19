import { createLogger } from "./log.ts";

const log = createLogger("app");

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * The application's lifetime: what it is running, and the order it comes to
 * rest in. Work belongs here rather than to whatever started it, so a worker
 * outlives its parent's turn but never the application.
 */
export interface AppLifetime {
  /** Aborted as shutdown begins. Whatever schedules work checks it first. */
  readonly closing: AbortSignal;
  /**
   * Register something that runs work. At shutdown `stop` asks that work to
   * cancel and resolves once it has settled. Stops are called in the order
   * registered, each running synchronously up to its first wait.
   */
  own(name: string, stop: () => Promise<void> | void): void;
  /** Hold one background task until it settles. Its failure is its own to report. */
  track(name: string, task: Promise<unknown>): void;
  /**
   * Register a dependency the running work uses. Closed only after that work
   * has settled or run out of time, one at a time, in the order registered. A
   * close that outlasts the bound is left behind like any other work.
   */
  onClose(name: string, close: () => Promise<void> | void): void;
  /**
   * Bring the application to rest: stop new scheduling, ask running work to
   * cancel, wait a bounded time for it to settle, then close dependencies.
   * Every call returns the same shutdown, so a repeated signal joins the one
   * in progress. Never rejects.
   */
  shutdown(): Promise<void>;
}

interface Named<T> {
  name: string;
  value: T;
}

/**
 * Create the lifetime an application's parts register with. Work that has not
 * settled within `timeoutMs` is named in the log and left behind: its
 * dependencies close regardless, and what it left unfinished is reconciled at
 * the next start. Each close is held to the same bound, so nothing a
 * dependency does can keep the application from stopping.
 */
export function createAppLifetime(options: { timeoutMs?: number } = {}): AppLifetime {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const owners: Named<() => Promise<void> | void>[] = [];
  const closers: Named<() => Promise<void> | void>[] = [];
  const tasks = new Set<Named<Promise<unknown>>>();
  let shuttingDown: Promise<void> | undefined;

  // Resolves false when `work` is still going once the bound has passed.
  const within = async (work: Promise<unknown>): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const settled = await Promise.race([work.then(() => true as const), timedOut]);
    clearTimeout(timer);
    return settled;
  };

  const settleWork = async () => {
    const outstanding = new Set<Named<unknown>>();
    const watch = (entry: Named<unknown>, work: Promise<unknown>) => {
      outstanding.add(entry);
      return work
        .catch((cause) => log.error(`${entry.name} failed while stopping`, cause))
        .finally(() => outstanding.delete(entry));
    };
    const work = [
      // An async wrapper calls `stop` synchronously and turns a throw into a rejection.
      ...owners.map((owner) => watch(owner, (async () => owner.value())())),
      // A task reports its own failure; here it only has to have settled.
      ...[...tasks].map((task) =>
        watch(
          task,
          task.value.catch(() => {}),
        ),
      ),
    ];
    if (!(await within(Promise.all(work)))) {
      const names = [...outstanding].map(({ name }) => name).join(", ");
      log.warn(`shutdown did not settle within ${timeoutMs}ms: ${names}`);
    }
  };

  const closeDependencies = async () => {
    for (const { name, value: close } of closers) {
      // One dependency failing to close must not leave the rest open.
      const closed = (async () => close())().catch((cause) =>
        log.error(`closing ${name} failed`, cause),
      );
      if (!(await within(closed))) log.warn(`closing ${name} did not finish within ${timeoutMs}ms`);
    }
  };

  return {
    closing: controller.signal,
    own: (name, stop) => void owners.push({ name, value: stop }),
    onClose: (name, close) => void closers.push({ name, value: close }),
    track(name, task) {
      const entry = { name, value: task };
      tasks.add(entry);
      const forget = () => tasks.delete(entry);
      task.then(forget, forget);
    },
    shutdown() {
      shuttingDown ??= (async () => {
        controller.abort();
        await settleWork();
        await closeDependencies();
      })();
      return shuttingDown;
    },
  };
}
