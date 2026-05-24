/**
 * Pulsing dot in the `running` colour. Used as the in-flight indicator
 * beside status labels and duration values. `aria-hidden` — the
 * neighbouring text already conveys the running state to assistive tech.
 *
 * `self-center` makes the dot align with its siblings inside a
 * baseline-aligned flex container; it is harmless elsewhere.
 */
export function PulseDot() {
  return (
    <span
      aria-hidden="true"
      data-testid="pulse-dot"
      className="inline-block h-1.5 w-1.5 animate-pulse self-center rounded-full bg-status-running"
    />
  );
}
