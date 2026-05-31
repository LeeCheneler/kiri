import { useEffect, useState } from "react";
import { formatDurationMs } from "../../formatters/format-time.ts";

/**
 * A live-ticking elapsed duration from `startedAt` to the current time,
 * formatted compactly ("12s", "2m 30s") and set in tabular mono so the figure
 * doesn't jitter as it counts up. Re-renders once a second so the elapsed time
 * accrues while a step or run is in flight.
 *
 * `now` pins the clock: pass it and the duration is computed once with no
 * interval (deterministic tests, or any caller that already holds a fixed
 * reference time); omit it in production so the timer reads the system clock
 * and advances each second.
 */
export function LiveDuration({ startedAt, now }: { startedAt: string; now?: Date }) {
  // The tick state is a re-render pulse only — it deliberately holds no clock
  // value, so the duration always derives from a single render-time read below.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (now !== undefined) return;
    const id = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(id);
  }, [now]);

  const elapsedMs = (now?.getTime() ?? Date.now()) - new Date(startedAt).getTime();
  return <span className="tabular-nums">{formatDurationMs(elapsedMs)}</span>;
}
