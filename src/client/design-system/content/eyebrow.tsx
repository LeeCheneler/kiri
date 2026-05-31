import type { ReactNode } from "react";

type Tone = "accent" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  accent: "text-accent",
  muted: "text-ink-muted",
};

/**
 * The small mono uppercase kicker that sits above a page title or section
 * heading — "Dev · Workflow" over a workflow name, "Steps" over a group of
 * step rows. `tone` carries the emphasis: `accent` (default) is the page's
 * lead eyebrow, in the accent colour so the title reads as the start of the
 * page; `muted` is the quieter label that heads a section *within* a page,
 * where an accent kicker would compete with the lead. Renders a `<p>` and
 * owns only its type treatment — the space around it is the caller's. The
 * tone is reflected as `data-tone` so containers and tests can anchor on it
 * without inspecting CSS.
 */
export function Eyebrow({
  tone = "accent",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <p
      data-tone={tone}
      className={`font-mono text-xs uppercase tracking-widest ${TONE_CLASSES[tone]}`}
    >
      {children}
    </p>
  );
}
