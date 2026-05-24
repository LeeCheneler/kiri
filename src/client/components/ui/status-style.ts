/** The six terminal-or-transient states a run (or run step) can be in. */
export type StatusKind = "pending" | "running" | "ok" | "failed" | "cancelled" | "interrupted";

/** Background-colour utility per status, used by the left-edge status strip. */
export const STATUS_STRIP_BG: Record<StatusKind, string> = {
  pending: "bg-status-pending",
  running: "bg-status-running",
  ok: "bg-status-ok",
  failed: "bg-status-failed",
  cancelled: "bg-status-cancelled",
  interrupted: "bg-status-interrupted",
};

/** Text-colour utility per status, used by the status label/word. */
export const STATUS_TEXT: Record<StatusKind, string> = {
  pending: "text-status-pending",
  running: "text-status-running",
  ok: "text-status-ok",
  failed: "text-status-failed",
  cancelled: "text-status-cancelled",
  interrupted: "text-status-interrupted",
};
