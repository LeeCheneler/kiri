/**
 * A framed code panel with a filename tab — the site's way of presenting a
 * real kiri file (a workflow, a terminal session) as a first-class artifact.
 * Reuses the design system's surface tokens so it reads as part of the app;
 * the content is plain monospace text, never syntax-recoloured.
 */
export function CodeWindow({ filename, children }: { filename: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-sm border border-rule">
      <div className="flex items-center border-rule border-b bg-paper-2 px-4 py-2.5">
        <span className="font-mono text-xs text-ink-faint tracking-wide">{filename}</span>
      </div>
      <pre className="overflow-x-auto bg-paper p-5 font-mono text-sm text-ink leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}
