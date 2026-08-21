import type { ReactNode } from "react";

/**
 * The states a run, run step, or session can be in. Runs use
 * `pending`/`running`/`ok`/`interrupted`; sessions use `idle` (resting between
 * turns), `working` (a turn streaming), and `waiting` (paused on tool approval,
 * blocked on the user); `failed` and `cancelled` are shared.
 */
export type StatusKind =
  | "pending"
  | "running"
  | "working"
  | "waiting"
  | "idle"
  | "ok"
  | "failed"
  | "cancelled"
  | "interrupted";

const STATUS_TEXT: Record<StatusKind, string> = {
  pending: "text-status-pending",
  running: "text-status-running",
  working: "text-status-working",
  waiting: "text-status-waiting",
  idle: "text-status-idle",
  ok: "text-status-ok",
  failed: "text-status-failed",
  cancelled: "text-status-cancelled",
  interrupted: "text-status-interrupted",
};

// The live states: each renders a pulsing dot beside the word as a cue that
// the entity needs watching — in-flight (`running`, `working`) or blocked on
// the user (`waiting`). Listed as full class names (not interpolated) so
// Tailwind keeps them.
const STATUS_DOT: Partial<Record<StatusKind, string>> = {
  running: "bg-status-running",
  working: "bg-status-working",
  waiting: "bg-status-waiting",
};

/**
 * The status word, tinted in its `text-status-*` token. The live states
 * (`running`, `working`, `waiting`) also render a small pulsing dot beside the
 * word as a cue (the dot is decorative — the word already conveys the state). Exposes
 * the state as `data-status` so containers and tests can anchor on it without
 * reading styles. Upper-cases the word centrally (its canonical machine-layer
 * form) and stays `font-mono`, leaving size to the caller. Pass children to
 * stand a longer label in for the bare word — a row badging `worker waiting`,
 * say — keeping the state's tint, dot, and anchor.
 */
export function Status({ status, children }: { status: StatusKind; children?: ReactNode }) {
  const word = children ?? status;
  const dot = STATUS_DOT[status];
  if (dot) {
    return (
      <span
        data-status={status}
        className={`inline-flex items-baseline gap-1.5 font-mono uppercase ${STATUS_TEXT[status]}`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 animate-pulse self-center rounded-full ${dot}`}
        />
        {word}
      </span>
    );
  }
  return (
    <span data-status={status} className={`font-mono uppercase ${STATUS_TEXT[status]}`}>
      {word}
    </span>
  );
}
