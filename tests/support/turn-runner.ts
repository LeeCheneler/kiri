import { createTurnStarter } from "../../src/server/sessions/turn-start.ts";
import type {
  ResumeTurnArgs,
  RunTurnArgs,
  RunTurnDeps,
  StartedTurn,
} from "../../src/server/sessions/turn.ts";

// A starter over a preparation that hands back `deps` as they stand, so a test
// states a turn's dependencies directly and still starts it the way every
// driver does.
const starterFor = (deps: RunTurnDeps) =>
  createTurnStarter({
    db: deps.db,
    prepareTurn: (session) => ({ session, turnDeps: deps }),
  });

/** Start a turn on a user message against exactly `deps`. */
export const runTurn = (deps: RunTurnDeps, args: RunTurnArgs): Promise<StartedTurn> =>
  starterFor(deps)(args.session, { kind: "message", userMessage: args.userMessage });

/** Resume a turn paused on tool approvals against exactly `deps`. */
export const resumeTurn = (deps: RunTurnDeps, args: ResumeTurnArgs): Promise<StartedTurn> =>
  starterFor(deps)(args.session, { kind: "approvals", approvals: args.approvals });

/** Start a turn from the session's queued backlog against exactly `deps`; null when nothing is queued. */
export const runWakeTurn = (
  deps: RunTurnDeps,
  args: Pick<RunTurnArgs, "session">,
): Promise<StartedTurn | null> => starterFor(deps)(args.session, { kind: "wake" });
