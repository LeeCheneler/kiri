/** Runs a task once the limiter has a free slot, resolving with the task's result. */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * A first-in-first-out concurrency gate: at most `limit` tasks run at once and
 * the rest wait their turn. For fanning a page's worth of requests out to an
 * endpoint that costs the server real work per call, without arriving as one
 * burst. A slot is freed whether its task resolves or throws, and callers see
 * the task's own result or error unchanged.
 */
export function createLimiter(limit: number): Limiter {
  let active = 0;
  const waiting: (() => void)[] = [];

  // Admission increments the count, so waking a waiter hands the freed slot
  // straight to it — no window in which a later caller can take it first.
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiting.push(() => {
        active += 1;
        resolve();
      });
    });
  };

  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  return async (task) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
