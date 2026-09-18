import type { UIMessage } from "ai";
import type { KiriDb } from "../db/index.ts";
import { pendingInboxItems } from "./inbox.ts";
import type { Session } from "./store.ts";
import {
  type PreparedTurn,
  type StartedTurn,
  type ToolApprovalDecision,
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
  /** Makes the session ready to run (see `TurnPreparation.prepareTurn`). */
  prepareTurn: (session: Session) => PreparedTurn;
}

/**
 * Create the one path by which a turn starts, whoever drives it: prepare the
 * session, then run the turn its start describes against the prepared session.
 * The caller has checked the session is out of a turn. Rejects when the turn
 * cannot start, with its cancellation registration released.
 */
export function createTurnStarter(deps: TurnStarterDeps): StartTurn {
  const { db, prepareTurn } = deps;

  const run = ({ session, turnDeps }: PreparedTurn, start: TurnStart) => {
    if (start.kind === "message") {
      return runTurn(turnDeps, { session, userMessage: start.userMessage });
    }
    if (start.kind === "approvals") {
      return resumeTurn(turnDeps, { session, approvals: start.approvals });
    }
    return runWakeTurn(turnDeps, { session });
  };

  const startTurn = async (session: Session, start: TurnStart): Promise<StartedTurn | null> => {
    if (start.kind === "wake" && pendingInboxItems(db, session.id).length === 0) return null;
    const prepared = prepareTurn(session);
    try {
      return await run(prepared, start);
    } catch (cause) {
      prepared.turnDeps.cancelRegistry?.release(session.id);
      throw cause;
    }
  };
  return startTurn as StartTurn;
}
