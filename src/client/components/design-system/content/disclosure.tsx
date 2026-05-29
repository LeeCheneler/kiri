import { type ReactNode, useId, useState } from "react";

/**
 * An expand/collapse region — a full-width trigger button with a trailing
 * caret that toggles a content panel. `summary` is the always-visible trigger
 * content (a label, or a richer row the caller styles); `children` is the
 * panel, rendered only while open. Owns its open state — pass `defaultOpen`
 * to start expanded. The trigger and panel are wired together with
 * `aria-expanded` / `aria-controls` for assistive tech. Carries no outer
 * margin.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <span aria-hidden="true" className="shrink-0 font-mono text-xs text-ink-muted">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div id={panelId} className="px-4 pt-1 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}
