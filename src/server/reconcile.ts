import { eq } from "drizzle-orm";
import type { KiriDb } from "./db/index.ts";
import { runSteps, runs, sessions } from "./db/schema.ts";

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
  db.update(sessions)
    .set({ status: "failed", finishedAt: new Date(), error: INTERRUPTED_ERROR })
    .where(eq(sessions.status, "running"))
    .run();
}
