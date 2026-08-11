import type { ReactNode } from "react";

/**
 * A framed code panel with a filename tab — the site's way of presenting a
 * real kiri file (a workflow, a terminal session) as a first-class artifact.
 * Reuses the design system's surface tokens so it reads as part of the app;
 * the content is plain monospace text, never syntax-recoloured. `actions`
 * renders right-aligned in the tab bar, for a control that belongs to the
 * panel (e.g. a copy button).
 */
export function CodeWindow({
  filename,
  actions,
  children,
}: {
  filename: string;
  actions?: ReactNode;
  children: string;
}) {
  return (
    <div className="overflow-hidden rounded-sm border border-rule">
      <div className="flex items-center justify-between gap-3 border-rule border-b bg-paper-2 px-4 py-2.5">
        <span className="font-mono text-xs text-ink-faint tracking-wide">{filename}</span>
        {actions}
      </div>
      <pre className="overflow-x-auto bg-paper p-5 font-mono text-sm text-ink leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}
