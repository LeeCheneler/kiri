/** The states a run (or run step) can be in. */
export type StatusKind = "pending" | "running" | "ok" | "failed" | "cancelled" | "interrupted";

const STATUS_TEXT: Record<StatusKind, string> = {
  pending: "text-status-pending",
  running: "text-status-running",
  ok: "text-status-ok",
  failed: "text-status-failed",
  cancelled: "text-status-cancelled",
  interrupted: "text-status-interrupted",
};

/**
 * The status word, tinted in its `text-status-*` token. The `running` state
 * also renders a small pulsing dot beside the word as an in-flight cue (the
 * dot is decorative — the word already conveys the state). Exposes the state
 * as `data-status` so containers and tests can anchor on it without reading
 * styles. Stays `font-mono` (it's a machine-layer word) but leaves size and
 * case to the caller.
 */
export function Status({ status }: { status: StatusKind }) {
  if (status === "running") {
    return (
      <span
        data-status={status}
        className={`inline-flex items-baseline gap-1.5 font-mono ${STATUS_TEXT.running}`}
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 animate-pulse self-center rounded-full bg-status-running"
        />
        {status}
      </span>
    );
  }
  return (
    <span data-status={status} className={`font-mono ${STATUS_TEXT[status]}`}>
      {status}
    </span>
  );
}
