import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "../actions/button.tsx";
import { CodeBlock } from "./code.tsx";

/** CodeBlock's line height (`text-sm`) and vertical padding (`p-4`), in rem. */
const LINE_HEIGHT_REM = 1.25;
const PADDING_REM = 2;

/**
 * A log pane: a `CodeBlock` held to at most `lines` lines, showing the
 * newest output. While collapsed the pane scrolls internally and stays
 * pinned to its foot, so text that grows live — a step's console — keeps
 * its latest line in view without any scroll bookkeeping; a reader who
 * scrolls up to look back stays where they scrolled. Text that fits shows
 * nothing extra; text that overflows gets a "show more" action beneath,
 * which opens the pane to its full height and swaps for "show less".
 * Overflow is measured off the DOM — on mount, whenever the text changes,
 * and on window resize — so the action appears only when there is more to
 * see. The action carries `aria-expanded` for assistive tech. Owns no outer
 * margin.
 */
export function Log({ lines = 10, children }: { lines?: number; children: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text or the line budget changes — the overflow is read off the DOM node, not the closure.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [children, lines, expanded]);

  return (
    <div>
      <div
        ref={ref}
        // column-reverse pins the scroll to the foot, so the pane follows
        // its newest output with no scroll bookkeeping.
        className={expanded ? undefined : "flex flex-col-reverse overflow-y-auto"}
        style={expanded ? undefined : { maxHeight: `${lines * LINE_HEIGHT_REM + PADDING_REM}rem` }}
      >
        <CodeBlock>{children}</CodeBlock>
      </div>
      {overflows || expanded ? (
        <div className="mt-1">
          <Button
            variant="dismissive"
            size="inline"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "show less" : "show more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
