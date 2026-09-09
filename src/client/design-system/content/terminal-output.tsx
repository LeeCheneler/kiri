import Ansi from "ansi-to-react";

/**
 * Terminal output with ANSI colours and text decoration interpreted safely as
 * React nodes. Preserves whitespace and scrolls long lines without reflowing.
 */
export function TerminalOutput({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto border border-rule bg-paper p-4 font-mono text-sm text-ink">
      <Ansi>{children}</Ansi>
    </pre>
  );
}
