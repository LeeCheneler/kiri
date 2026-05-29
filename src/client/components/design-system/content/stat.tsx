import type { ReactNode } from "react";

type Tone = "default" | "ok" | "failed";

const TONE_CLASSES: Record<Tone, string> = {
  default: "text-ink",
  ok: "text-status-ok",
  failed: "text-status-failed",
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
 * A single statistic within a `<StatList>` — an uppercase label above a large
 * figure, as a `<dt>`/`<dd>` pair. The value is the children, so units like
 * `601ms` read naturally. `tone` tints the figure: `default` ink, `ok` and
 * `failed` to the matching status colour. The tone is reflected as `data-tone`
 * so containers and tests can anchor on it without inspecting CSS.
 */
export function Stat({
  label,
  tone = "default",
  children,
}: {
  label: string;
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <div data-tone={tone} className="flex flex-col gap-0.5">
      <dt className="font-mono text-xs tracking-widest text-ink-muted uppercase">{label}</dt>
      <dd className={`font-mono text-2xl leading-none tabular-nums ${TONE_CLASSES[tone]}`}>
        {children}
      </dd>
    </div>
  );
}
