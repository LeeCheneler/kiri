import type { ReactNode } from "react";

type Tone = "default" | "ok" | "failed";
type Size = "lg" | "sm";

const TONE_CLASSES: Record<Tone, string> = {
  default: "text-ink",
  ok: "text-status-ok",
  failed: "text-status-failed",
};

// `lg` is the headline figure; `sm` steps it down for marginalia (a side rail)
// where a hero number would shout over the surrounding text.
const SIZE_CLASSES: Record<Size, string> = {
  lg: "text-2xl",
  sm: "text-base",
};

/**
 * A strip of summary statistics, rendered as a description list so each
 * label and figure form a real term–value pair. Lays its `<Stat>` children
 * out in a wrapping row with even spacing; it owns the row and its gaps, and
 * nothing around it.
 */
export function StatList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-wrap gap-x-7 gap-y-4">{children}</dl>;
}

/**
 * A single statistic within a `<StatList>` — an uppercase label above a figure,
 * as a `<dt>`/`<dd>` pair. The value is the children, so units like `601ms` read
 * naturally. `tone` tints the figure: `default` ink, `ok` and `failed` to the
 * matching status colour. `size` sets the figure's scale: `lg` (default) for a
 * headline strip, `sm` for marginalia. The tone is reflected as `data-tone` so
 * containers and tests can anchor on it without inspecting CSS.
 */
export function Stat({
  label,
  tone = "default",
  size = "lg",
  children,
}: {
  label: string;
  tone?: Tone;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <div data-tone={tone} className="flex flex-col gap-0.5">
      <dt className="font-mono text-xs tracking-widest text-ink-muted uppercase">{label}</dt>
      <dd
        className={`font-mono ${SIZE_CLASSES[size]} leading-none tabular-nums ${TONE_CLASSES[tone]}`}
      >
        {children}
      </dd>
    </div>
  );
}
