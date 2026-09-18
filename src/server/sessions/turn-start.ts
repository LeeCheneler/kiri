import type { UIMessage } from "ai";
import type { KiriDb } from "../db/index.ts";
import type { LlmClients } from "../llm/index.ts";
import { pendingInboxItems } from "./inbox.ts";
import type { Session } from "./store.ts";
import type { TurnLease, TurnLifecycle } from "./turn-lifecycle.ts";
import {
  type PreparedTurn,
  type StartedTurn,
  type ToolApprovalDecision,
  applyPendingApprovals,
  resumeTurn,
  runTurn,
  runWakeTurn,
} from "./turn.ts";

/** What opens a turn: a user's message, their verdicts on a paused turn, or the session's queued backlog alone. */
export type TurnStart =
  | { kind: "message"; userMessage: UIMessage }
  | { kind: "approvals"; approvals: ToolApprovalDecision[] }
  | { kind: "wake" };

/** Starts a session's turn the same way for every driver. */
export interface StartTurn {
  (session: Session, start: Exclude<TurnStart, { kind: "wake" }>): Promise<StartedTurn>;
  /**
   * A wake resolves null, leaving the session unprepared, when nothing is
   * queued for it: no turn will run, so a working-directory repair made now
   * would be explained to no one.
   */
  (session: Session, start: TurnStart): Promise<StartedTurn | null>;
}

export interface TurnStarterDeps {
  db: KiriDb;
  /** Resolves the session's model before anything is written. */
  llmClients: LlmClients;
  /** Leases the session to the turn being started. */
  lifecycle: TurnLifecycle;
  /** Makes the session ready to run (see `TurnPreparation.prepareTurn`). */
  prepareTurn: (session: Session) => PreparedTurn;
}

/**
 * Create the one path by which a turn starts, whoever drives it: lease the
 * session to the new execution, check the start can go ahead, prepare the
 * session, then run the turn its start describes under that lease. Throws
 * `TurnInFlightError`, having done nothing, when the session already has a
 * turn executing.
 *
 * A start that fails gives the session back. A user's message or verdicts
 * reject to the caller that sent them, leaving a session that never began
 * untouched. Nobody is waiting on a wake, so its failure is recorded on the
 * session as a settled `failed` turn — which is what tells a worker's parent.
 */
export function createTurnStarter(deps: TurnStarterDeps): StartTurn {
  const { db, llmClients, lifecycle, prepareTurn } = deps;

  const run = (session: Session, start: TurnStart, lease: TurnLease) => {
    // Whatever can refuse the start outright is settled before preparation,
    // which may move the session's working directory: a repair made for a
    // turn that never runs would be explained to no one.
    const model = llmClients.resolveModel(session.model);
    const approved =
      start.kind === "approvals" ? applyPendingApprovals(db, session, start.approvals) : null;
    const prepared = prepareTurn(session);
    const args = { session: prepared.session, lease, model };
    if (approved) return resumeTurn(prepared.turnDeps, { ...args, approved });
    if (start.kind === "message") {
      return runTurn(prepared.turnDeps, { ...args, userMessage: start.userMessage });
    }
    return runWakeTurn(prepared.turnDeps, args);
  };

  const startTurn = async (session: Session, start: TurnStart): Promise<StartedTurn | null> => {
    if (start.kind === "wake" && pendingInboxItems(db, session.id).length === 0) return null;
    const lease = lifecycle.acquire(session.id);
    try {
      return await run(session, start, lease);
    } catch (cause) {
      if (start.kind === "wake") {
        lease.settle({
          status: "failed",
          error: { message: cause instanceof Error ? cause.message : String(cause) },
          messageId: null,
        });
      } else {
        lease.fail(cause);
      }
      throw cause;
    }
  };
  return startTurn as StartTurn;
}
