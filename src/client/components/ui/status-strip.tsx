import type { StatusKind } from "./status-style.ts";
import { STATUS_STRIP_BG } from "./status-style.ts";

type Weight = "header" | "row";

const SIZING: Record<Weight, string> = {
  header: "inset-y-0 left-0 w-1",
  row: "inset-y-2 left-1 w-0.5",
};

/**
 * Absolutely-positioned coloured strip sitting at the left edge of a
 * status-bearing container. The parent must be `position: relative`.
 * `weight` switches between the thicker page-header strip and the
 * thinner activity-row strip. `hoverGrow` adds a hover transition that
 * widens the strip — for use inside a `group` whose parent row is
 * interactive (so a non-interactive row doesn't appear to invite a
 * click it can't act on).
 */
export function StatusStrip({
  status,
  weight,
  hoverGrow = false,
}: {
  status: StatusKind;
  weight: Weight;
  hoverGrow?: boolean;
}) {
  const hover = hoverGrow ? " transition-all duration-150 group-hover:w-[3px]" : "";
  return (
    <span
      aria-hidden="true"
      data-weight={weight}
      className={`absolute ${SIZING[weight]} ${STATUS_STRIP_BG[status]}${hover}`}
    />
  );
}
