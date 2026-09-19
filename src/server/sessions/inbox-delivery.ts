import type { Session } from "./store.ts";

/** What prompts a look at a session's backlog: a message just queued, or a turn that just settled. */
export type InboxTrigger = "queued" | "settled";

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
// a `cancelled` session, and its backlog waits for them. A `failed` session
// wakes for a new message — a dead parent still hears a worker's report — but
// not when it settles: the failed turn was itself the delivery attempt, and
// waking on the same backlog would loop.
const DELIVERY: Record<InboxTrigger, Record<Session["status"], InboxDelivery>> = {
  queued: { running: "weave", waiting: "hold", idle: "wake", failed: "wake", cancelled: "hold" },
  settled: { running: "weave", waiting: "hold", idle: "wake", failed: "hold", cancelled: "hold" },
};

/** The delivery a session in `status` gives its backlog when `trigger` happens. */
export const inboxDelivery = (status: Session["status"], trigger: InboxTrigger): InboxDelivery =>
  DELIVERY[trigger][status];
