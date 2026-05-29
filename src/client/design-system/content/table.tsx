import type { ReactNode } from "react";

const CELLS =
  "[&_th]:border-b [&_th]:border-rule [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink [&_td]:border-b [&_td]:border-rule [&_td]:px-2 [&_td]:py-1 [&_td]:text-ink";

/**
 * Data table. Wraps a standard table in a horizontal-scroll container and
 * styles the header and cells — a hairline rule under each row, cells in
 * mono with tabular figures so columns of numbers align. Write semantic
 * markup (thead / tbody / tr / th / td) as children; the styling is applied
 * for you. Tabular data is the machine layer, so it is set in mono.
 */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse font-mono text-sm tabular-nums ${CELLS}`}>
        {children}
      </table>
    </div>
  );
}
