import type { ReactNode } from "react";
import type { StatusKind } from "./status.tsx";

const STATUS_BORDER: Record<StatusKind, string> = {
  pending: "border-status-pending",
  running: "border-status-running",
  ok: "border-status-ok",
  failed: "border-status-failed",
  cancelled: "border-status-cancelled",
  interrupted: "border-status-interrupted",
};

/**
 * A content block edged on the left with its status colour — the callout for
 * a run or step's outcome (a failed block edged red, an ok block green). Wraps
 * `children` behind the coloured border and exposes the state as `data-status`.
 * Carries its own left border and inset padding only; vertical rhythm between
 * stacked blocks is the caller's.
 */
export function StatusBlock({
  status,
  children,
}: {
  status: StatusKind;
  children: ReactNode;
}) {
  return (
    <div data-status={status} className={`border-l-2 pl-4 ${STATUS_BORDER[status]}`}>
      {children}
    </div>
  );
}
