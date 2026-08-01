/**
 * How many git invocations the scan keeps in flight. High enough to hide the
 * per-process latency that dominates a scan, low enough that a workspace of
 * dozens of repos doesn't swamp the machine with subprocesses.
 */
export const SCAN_CONCURRENCY = 8;

/**
 * Map `items` through `fn` with at most `limit` calls in flight, resolving to
 * the results in input order however they interleave — so concurrency never
 * leaks into the order of what is built from them.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
