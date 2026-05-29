/** One bar in a sparkline: a magnitude, a tone, and an optional tooltip label. */
export type SparklineBar = {
  value: number;
  tone: "ok" | "warm" | "failed";
  label?: string;
};

/** Shortest bar height (fraction of the track) so a near-zero value still shows. */
const MIN_BAR = 0.12;

const TONE_BG: Record<SparklineBar["tone"], string> = {
  ok: "bg-status-ok",
  warm: "bg-accent-warm",
  failed: "bg-status-failed",
};

/**
 * A compact bar chart for a sequence of recent measurements — one bar per
 * `value`, height scaled to the largest in the set so the shape reads at a
 * glance. A near-zero value still draws a stub bar (a floor of ~12% of the
 * track) so gaps don't vanish, and when every value is zero the bars all sit
 * at the floor. Each bar's `tone` colours it (`ok` / `warm` for
 * slower-than-usual / `failed`) and surfaces as `data-tone`; an optional
 * per-bar `label` becomes a hover tooltip.
 *
 * `label` names the whole chart for assistive tech (the bars themselves are
 * decorative). Pass `bars` in display order, left to right; optional
 * `startLabel` / `endLabel` caption the two ends of the axis. Owns no outer
 * margin or width — size it from the caller.
 */
export function Sparkline({
  bars,
  label,
  startLabel,
  endLabel,
}: {
  bars: SparklineBar[];
  label: string;
  startLabel?: string;
  endLabel?: string;
}) {
  const maxValue = Math.max(...bars.map((bar) => bar.value));
  return (
    <div>
      <div role="img" aria-label={label} className="flex h-11 items-end gap-[3px]">
        {bars.map((bar, index) => {
          const heightPct =
            (maxValue > 0 ? Math.max(MIN_BAR, bar.value / maxValue) : MIN_BAR) * 100;
          return (
            <span
              // Bars are a fixed positional series — never reordered or keyed by identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: positional bar series
              key={index}
              aria-hidden="true"
              data-tone={bar.tone}
              title={bar.label}
              className={`flex-1 ${TONE_BG[bar.tone]}`}
              style={{ height: `${heightPct.toFixed(1)}%` }}
            />
          );
        })}
      </div>
      {(startLabel !== undefined || endLabel !== undefined) && (
        <div className="mt-1.5 flex justify-between font-mono text-xs text-ink-faint">
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      )}
    </div>
  );
}
