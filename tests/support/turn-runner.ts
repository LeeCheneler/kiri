import { type EventBus, createEventBus } from "../../src/server/events/index.ts";
import type { Session } from "../../src/server/sessions/store.ts";
import {
  type StreamRegistry,
  createStreamRegistry,
} from "../../src/server/sessions/stream-registry.ts";
import {
  type TurnLifecycle,
  createTurnLifecycle,
} from "../../src/server/sessions/turn-lifecycle.ts";
import { createTurnStarter } from "../../src/server/sessions/turn-start.ts";
import type {
  PreparedTurn,
  RunTurnArgs,
  RunTurnDeps,
  StartedTurn,
  ToolApprovalDecision,
} from "../../src/server/sessions/turn.ts";

/** Cancels the turns started with it, as the runtime's `cancelTurn` does. */
export interface TurnCanceller {
  /** Abort the session's executing turn. False when none of the watched turns is executing. */
  cancel(sessionId: string): boolean;
  /** Reach the turns `lifecycle` leases; the runner calls this as it starts a turn. */
  watch(lifecycle: TurnLifecycle): void;
}

/** Create a canceller to hand to the turns a test wants to cancel. */
export function turnCanceller(): TurnCanceller {
  const lifecycles: TurnLifecycle[] = [];
  return {
    cancel: (sessionId) => lifecycles.some((lifecycle) => lifecycle.cancel(sessionId)),
    watch: (lifecycle) => {
      lifecycles.push(lifecycle);
    },
  };
}

/**
 * A turn's dependencies as a test states them. What a test leaves out is
 * filled with a small in-memory stand-in: a bus nobody listens to, a fresh
 * stream registry, and a lifecycle over the two. Supply `canceller` to cancel
 * the turn, or `lifecycle` to start two turns against one session.
 */
export type TestTurnDeps = Omit<RunTurnDeps, "bus"> & {
  bus?: EventBus;
  streamRegistry?: StreamRegistry;
  lifecycle?: TurnLifecycle;
  canceller?: TurnCanceller;
};

// A starter over a preparation that hands back `deps` as they stand, so a test
// states a turn's dependencies directly and still starts it the way every
// driver does.
const starterFor = ({ streamRegistry, lifecycle, canceller, ...deps }: TestTurnDeps) => {
  const bus = deps.bus ?? createEventBus();
  const turns =
    lifecycle ??
    createTurnLifecycle({
      db: deps.db,
      bus,
      streamRegistry: streamRegistry ?? createStreamRegistry(),
    });
  canceller?.watch(turns);
  return createTurnStarter({
    db: deps.db,
    llmClients: deps.llmClients,
    lifecycle: turns,
    prepareTurn: (session) => ({ session, turnDeps: { ...deps, bus } }),
  });
};

/** A starter over a fresh in-memory lifecycle on `bus`, for a driver under test. */
export const turnStarter = (deps: {
  db: RunTurnDeps["db"];
  llmClients: RunTurnDeps["llmClients"];
  bus: EventBus;
  prepareTurn: (session: Session) => PreparedTurn;
}) =>
  createTurnStarter({
    db: deps.db,
    llmClients: deps.llmClients,
    lifecycle: createTurnLifecycle({
      db: deps.db,
      bus: deps.bus,
      streamRegistry: createStreamRegistry(),
    }),
    prepareTurn: deps.prepareTurn,
  });

type Args = Pick<RunTurnArgs, "session">;

/** Start a turn on a user message against exactly `deps`. */
export const runTurn = (
  deps: TestTurnDeps,
  args: Args & Pick<RunTurnArgs, "userMessage">,
): Promise<StartedTurn> =>
  starterFor(deps)(args.session, { kind: "message", userMessage: args.userMessage });

/** Resume a turn paused on tool approvals against exactly `deps`. */
export const resumeTurn = (
  deps: TestTurnDeps,
  args: Args & { approvals: ToolApprovalDecision[] },
): Promise<StartedTurn> =>
  starterFor(deps)(args.session, { kind: "approvals", approvals: args.approvals });

/** Start a turn from the session's queued backlog against exactly `deps`; null when nothing is queued. */
export const runWakeTurn = (deps: TestTurnDeps, args: Args): Promise<StartedTurn | null> =>
  starterFor(deps)(args.session, { kind: "wake" });
