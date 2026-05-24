import type { StatusKind } from "./status-style.ts";
import { STATUS_STRIP_BG } from "./status-style.ts";

/**
 * Absolutely-positioned coloured strip sitting at the left edge of a
 * status-bearing container. The parent must be `position: relative`.
 * `hoverGrow` adds a hover transition that widens the strip — for use
 * inside a `group` whose parent row is interactive (so a non-
 * interactive row doesn't appear to invite a click it can't act on).
 */
export function StatusStrip({
  status,
  hoverGrow = false,
}: {
  status: StatusKind;
  hoverGrow?: boolean;
}) {
  const hover = hoverGrow ? " transition-all duration-150 group-hover:w-[3px]" : "";
  return (
    <span
      aria-hidden="true"
      className={`absolute inset-y-2 left-1 w-0.5 ${STATUS_STRIP_BG[status]}${hover}`}
    />
  );
}
