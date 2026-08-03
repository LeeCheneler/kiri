type Tone = "accent" | "warning" | "negative";

const TONE_BG: Record<Tone, string> = {
  accent: "bg-accent",
  warning: "bg-notice-warning",
  negative: "bg-status-failed",
};

/**
 * A slim gauge for consumption of a fixed budget — context window fill,
 * a quota, anything with a hard ceiling. `value` over `max` sets the fill,
 * clamped to the track; a non-zero value always draws a visible sliver so a
 * barely-used budget doesn't read as empty. `tone` escalates the fill colour
 * as the budget tightens (`accent` → `warning` → `negative`) and surfaces as
 * `data-tone`. `label` names the gauge for assistive tech; the numbers behind
 * it belong to the caller (a `Meta` caption alongside is the canonical pairing).
 * Owns no outer margin or width — size it from the caller.
 */
export function Meter({
  value,
  max,
  label,
  tone = "accent",
}: {
  value: number;
  max: number;
  label: string;
  tone?: Tone;
}) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      data-tone={tone}
      className="h-1 w-full bg-rule"
    >
      <div
        className={`h-full ${TONE_BG[tone]}`}
        style={{ width: ratio > 0 ? `max(2px, ${(ratio * 100).toFixed(2)}%)` : "0" }}
      />
    </div>
  );
}
