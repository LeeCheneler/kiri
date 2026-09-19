import type { InboxItem } from "./inbox.ts";
import type { Session } from "./store.ts";

/**
 * What prompts a look at a session's backlog: a message just queued — by the
 * user, or by another session (its parent, or one of its workers) — a turn
 * that just settled, or the app starting with messages still queued.
 */
export type InboxTrigger = "user-queued" | "session-queued" | "settled" | "startup";

/** The trigger a message queued by `source` raises. */
export const queuedBy = (source: InboxItem["source"]): InboxTrigger =>
  source === "user" ? "user-queued" : "session-queued";

/**
 * How a session's queued messages reach it:
 *
 * - `weave` — the turn in flight delivers them at its next step boundary.
 * - `hold` — they stay queued until the user acts, draining ahead of the next
 *   turn they start.
 * - `wake` — a turn starts now, opening with the drained backlog.
 */
export type InboxDelivery = "weave" | "hold" | "wake";

// A paused turn delivers on resume, but only the user resolves its approvals,
// so nothing queued may start or resume a `waiting` session. The user stopped
// a `cancelled` session: a message of their own is them starting it again,
// while another session's waits for them, as does whatever was queued before
// the stop. A `failed` session wakes for a new message — a dead parent still
// hears a worker's report — but not when it settles: the failed turn was
// itself the delivery attempt, and waking on the same backlog would loop.
// Startup recovers only what a wake would already have delivered had the app
// not stopped first: an interrupted turn is left failed for the user, never
// restarted on its own.
const DELIVERY: Record<InboxTrigger, Record<Session["status"], InboxDelivery>> = {
  "user-queued": {
    running: "weave",
    waiting: "hold",
    idle: "wake",
    failed: "wake",
    cancelled: "wake",
  },
  "session-queued": {
    running: "weave",
    waiting: "hold",
    idle: "wake",
    failed: "wake",
    cancelled: "hold",
  },
  settled: { running: "weave", waiting: "hold", idle: "wake", failed: "hold", cancelled: "hold" },
  startup: { running: "weave", waiting: "hold", idle: "wake", failed: "hold", cancelled: "hold" },
};

/** The delivery a session in `status` gives its backlog when `trigger` happens. */
export const inboxDelivery = (status: Session["status"], trigger: InboxTrigger): InboxDelivery =>
  DELIVERY[trigger][status];
