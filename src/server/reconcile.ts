import { and, eq, inArray } from "drizzle-orm";
import type { KiriDb } from "./db/index.ts";
import { messages, runSteps, runs, sessions } from "./db/schema.ts";

const INTERRUPTED_ERROR = { message: "interrupted by server restart" } as const;

/**
 * Sweep `runs` and `run_steps` rows still marked `running` into a terminal
 * `failed` state. Intended to run once at startup, after migrations and
 * before serving — any in-flight rows at that point are remnants of a prior
 * process that died mid-run, since `bootstrap()` is called single-threaded
 * before any executor can start. Idempotent: the `WHERE status = 'running'`
 * filter makes re-runs on a clean DB a no-op.
 */
export function reconcileInterruptedRuns(db: KiriDb): void {
  db.update(runs)
    .set({ status: "failed", finishedAt: new Date(), error: INTERRUPTED_ERROR })
    .where(eq(runs.status, "running"))
    .run();

  db.update(runSteps)
    .set({ status: "failed", error: INTERRUPTED_ERROR })
    .where(eq(runSteps.status, "running"))
    .run();
}

/**
 * Sweep `sessions` still marked `running` into a terminal `failed` state. A
 * `running` session is an in-flight turn; at startup any such row is a remnant
 * of a prior process that died mid-turn (the turn streamed in-process, so it
 * cannot have survived the restart). Idle sessions are left untouched — they
 * are resumable. Idempotent, like `reconcileInterruptedRuns`, and intended to
 * run alongside it once at startup.
 */
export function reconcileInterruptedSessions(db: KiriDb): void {
  db.transaction(() => {
    const interrupted = db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.status, "running"))
      .all()
      .map((session) => session.id);
    if (interrupted.length === 0) return;

    // A checkpoint survived but its turn did not. Publish that durable final
    // state to search in the same transaction that settles the dead session.
    db.update(messages)
      .set({ searchPending: false })
      .where(and(inArray(messages.sessionId, interrupted), eq(messages.searchPending, true)))
      .run();
    db.update(sessions)
      .set({ status: "failed", finishedAt: new Date(), error: INTERRUPTED_ERROR })
      .where(inArray(sessions.id, interrupted))
      .run();
  });
}
