const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

/**
 * Format an ISO timestamp as a relative phrase (e.g. "3 minutes ago", "now",
 * "yesterday"). Picks the coarsest unit whose magnitude is ≥ 1, so a 90-second
 * gap renders as "1 minute ago" rather than "90 seconds ago". `now` is
 * injectable so callers can produce deterministic output in tests.
 */
export const formatRelativeTime = (iso: string, now: Date = new Date()): string => {
  const delta = (new Date(iso).getTime() - now.getTime()) / 1000;
  for (const [unit, secsPerUnit] of RELATIVE_UNITS) {
    if (Math.abs(delta) >= secsPerUnit) {
      return RELATIVE_FORMATTER.format(Math.round(delta / secsPerUnit), unit);
    }
  }
  return RELATIVE_FORMATTER.format(Math.round(delta), "second");
};

/**
 * Format the gap between two ISO timestamps as a compact duration string:
 * `420ms`, `1.4s`, `12s`, `2m 30s`, `1h 5m`. Clamps negative values to zero
 * so a clock skew between rows doesn't surface as "-1s".
 */
export const formatDuration = (startedAt: string, finishedAt: string): string => {
  const ms = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};
