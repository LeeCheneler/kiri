import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import { createLogger } from "../log.ts";
import { enqueueInboxItem } from "./inbox.ts";
import { type Session, getSession } from "./store.ts";
import { type RunTurnDeps, runWakeTurn } from "./turn.ts";

const log = createLogger("sessions");

export interface DelegationMessagingDeps {
  db: KiriDb;
  bus: EventBus;
  /**
   * Assembles the turn dependencies any session runs against — the worker
   * deps for a delegated child, the full catalogue for a top-level session —
   * so a wake can start a turn for whichever side of a delegation the
   * message landed on.
   */
  turnDepsFor: (sessionId: string) => RunTurnDeps;
}

// The statuses a queued message wakes: out of a turn, with nothing else set
// to deliver the backlog. `waiting` is excluded — approvals stay user-only,
// so the backlog delivers when the user resolves them — as is `cancelled`:
// the user explicitly stopped that session, so its backlog waits for them.
// `failed` wakes so a dead parent still hears a worker's report (the wake
// turn clears the terminal markers, like any resumed turn).
const WAKEABLE: ReadonlySet<Session["status"]> = new Set(["idle", "failed"]);

/**
 * The messaging loop that lets delegations run as plain sessions talking
 * through their inboxes. One bus subscription carries the whole behaviour:
 *
 * - A message enqueued to a session that is out of a turn starts one — a wake
 *   turn opening with the drained backlog. (A busy session's messages weave
 *   in at its next step boundary; a `waiting` session's deliver when the user
 *   resolves its approvals — a wake never bypasses one.)
 * - A session that settles idle with messages still queued gets its wake turn
 *   straight away: a message that arrives after a running turn's last step
 *   boundary misses both the weave and the enqueue-time wake, and would
 *   otherwise sit until something else stirred the session. A turn that
 *   settles `failed` deliberately does not re-wake — its own delivery
 *   attempt failing would loop — so a failed session waits for the next
 *   message (or the user) to try again.
 * - A delegated child whose turn fails enqueues a brief failure notice to its
 *   parent — the one system-authored message — so the parent never stalls
 *   silently on a dead worker.
 *
 * Returns the unsubscribe function. Wake turns run detached: failures land on
 * the session's own status through the turn machinery, and are logged here.
 */
export function mountDelegationMessaging(deps: DelegationMessagingDeps): () => void {
  const { db, bus, turnDepsFor } = deps;

  const wake = (sessionId: string) => {
    const session = getSession(db, sessionId);
    if (!session || !WAKEABLE.has(session.status)) return;
    // `runWakeTurn` runs synchronously up to marking the session `running`
    // (or returns null on an already-drained backlog), so a second queued
    // event on the same tick finds it unwakeable rather than racing a
    // concurrent turn.
    void runWakeTurn(turnDepsFor(sessionId), { session })
      .then((started) => started?.done)
      .catch((cause) => log.error(`wake turn for session ${sessionId} failed`, cause));
  };

  const notifyParentOfFailure = (child: Session) => {
    if (child.parentSessionId === null) return;
    const error = (child.error as { message?: string } | null)?.message;
    enqueueInboxItem(db, child.parentSessionId, {
      source: "child",
      fromSessionId: child.id,
      text: `Automatic notice: this worker's turn failed and it has stopped${error ? ` — ${error}` : ""}. It did not report a result. Message it to retry, or spawn a replacement.`,
    });
    // Publishing the queued event hands delivery to the same loop: the
    // notice weaves into a busy parent or wakes an idle one.
    bus.publish({ type: "session.inbox.queued", sessionId: child.parentSessionId });
  };

  return bus.subscribe((event) => {
    if (event.type === "session.inbox.queued") wake(event.sessionId);
    if (event.type === "session.updated" && event.status === "idle") wake(event.id);
    if (event.type === "session.finished" && event.status === "failed") {
      const session = getSession(db, event.id);
      if (session) notifyParentOfFailure(session);
    }
  });
}
