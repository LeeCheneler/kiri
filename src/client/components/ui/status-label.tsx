import { PulseDot } from "./pulse-dot.tsx";
import type { StatusKind } from "./status-style.ts";
import { STATUS_TEXT } from "./status-style.ts";

/**
 * Colour-tinted status word, in the `text-status-*` token for the
 * status. When `status === "running"` the label also renders a
 * `<PulseDot>` beside the text.
 *
 * The element exposes the status via `data-status` so containers and
 * tests can anchor against the rendered label without inspecting CSS.
 */
export function StatusLabel({ status }: { status: StatusKind }) {
  if (status === "running") {
    return (
      <span
        data-status={status}
        className={`inline-flex items-baseline gap-1.5 ${STATUS_TEXT.running}`}
      >
        <PulseDot />
        {status}
      </span>
    );
  }
  return (
    <span data-status={status} className={STATUS_TEXT[status]}>
      {status}
    </span>
  );
}
