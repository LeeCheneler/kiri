import type { ReactNode } from "react";

/**
 * Tone vocabulary for a state label: `neutral` is a plain fact, `positive` a
 * settled good state, `caution` something with work in it, `negative` something
 * broken or discardable, and `accent` a structural marker rather than a state.
 */
export type TagTone = "neutral" | "positive" | "caution" | "negative" | "accent";

// Full class names per tone (never interpolated) so Tailwind keeps them. Each
// is its hue over a wash of itself, so a rail of tags reads as colour first and
// words second.
const TONE_CLASSES: Record<TagTone, string> = {
  neutral: "border-rule bg-paper-2 text-ink-muted",
  positive: "border-status-ok/40 bg-status-ok/10 text-status-ok",
  caution: "border-status-interrupted/40 bg-status-interrupted/10 text-status-interrupted",
  negative: "border-status-failed/40 bg-status-failed/10 text-status-failed",
  accent: "border-accent/40 bg-accent/10 text-accent",
};

/**
 * A compact toned state label — a small mono uppercase chip naming one fact
 * about the thing beside it (`dirty`, `ahead 2`, `locked`, `primary`). Built to
 * sit several-in-a-row as a scannable rail, where the tone does the reading and
 * the word confirms it. `tone` carries the meaning and is reflected as
 * `data-tone` so containers and tests can anchor on it without inspecting CSS.
 *
 * Distinct from `Status`, which speaks the fixed run/session status vocabulary,
 * and from `ToggleChip`, which is an interactive control. Reach for Tag when the
 * label is a static fact in a vocabulary of its own. It owns its chrome only —
 * lay a group out in a `flex flex-wrap` with your own gap.
 */
export function Tag({ tone = "neutral", children }: { tone?: TagTone; children: ReactNode }) {
  return (
    <span
      data-tone={tone}
      className={`inline-block rounded-sm border px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase leading-none tracking-widest ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
