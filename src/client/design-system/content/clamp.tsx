import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../actions/button.tsx";

/**
 * A block of text held to at most `lines` lines until the reader asks for
 * the rest. Content that fits shows nothing extra; content that overflows is
 * cut at the last visible line with a "show more" action beneath, which
 * swaps for "show less" once expanded. Overflow is measured off the DOM —
 * on mount, whenever the children change, and on window resize — so the
 * action appears only when there is genuinely more to read. The action
 * carries `aria-expanded` for assistive tech. Owns no outer margin.
 */
export function Clamp({ lines = 3, children }: { lines?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the content or the line budget changes — the overflow is read off the DOM node, not the closure.
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
        style={
          expanded
            ? undefined
            : {
                display: "-webkit-box",
                WebkitLineClamp: lines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
        }
      >
        {children}
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
