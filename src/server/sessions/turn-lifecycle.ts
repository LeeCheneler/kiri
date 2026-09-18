import type { KiriDb } from "../db/index.ts";
import type { EventBus, SessionStatus } from "../events/index.ts";
import { type Message, setSessionStatus } from "./store.ts";
import type { StreamRegistry, StreamSink } from "./stream-registry.ts";

/** Thrown by `acquire` when the session already has a turn executing. */
export class TurnInFlightError extends Error {
  constructor(sessionId: string) {
    super(`session "${sessionId}" already has a turn in flight`);
    this.name = "TurnInFlightError";
  }
}

/** How a turn came to rest, handed to the lease that owns it. */
export interface TurnSettlement {
  /** Where the session rests: `waiting` is an approval pause, not an end. */
  status: Exclude<SessionStatus, "running">;
  /** Recorded on a `failed` or `cancelled` session. */
  error?: { message: string; code?: string };
  /** The assistant message the turn saved, or null when it saved none. */
  messageId: string | null;
  /** A failed turn that stopped at a work or context limit rather than on an error. */
  incomplete?: boolean;
}

/**
 * One execution's hold on a session. The session identifies the conversation;
 * the lease identifies the turn running in it, and owns that turn's
 * cancellation signal, its resumable stream, and every status write between
 * `running` and the state the turn settles in.
 */
export interface TurnLease {
  /** Identifies this execution among the session's turns. */
  turnId: string;
  /** Aborted by a cancel, including one that arrives before the stream exists. */
  signal: AbortSignal;
  /** Mark the session `running`, clearing the markers of an earlier failed or cancelled turn. */
  begin(): void;
  /** Open the turn's resumable stream over the transcript as it stood before the turn; closed when the lease settles. */
  openStream(messages: Message[], transcriptRevision: number): StreamSink;
  /**
   * Bring the turn to rest: record the status, close the stream, release the
   * session, then publish what happened. The session is released before the
   * events go out because an idle event can start the next turn synchronously.
   * Only the first call on a live lease acts; a repeat, or one made after
   * `fail`, changes nothing.
   */
  settle(settlement: TurnSettlement): void;
  /**
   * Give up on a turn that could not start or carry on. Before `begin` the
   * session is released untouched; after it the turn settles as `failed`.
   */
  fail(cause: unknown): void;
  /** Resolves once the lease has settled or failed. Never rejects. */
  done: Promise<void>;
}

export interface TurnLifecycleDeps {
  db: KiriDb;
  bus: EventBus;
  /** Where each lease opens its stream, so a reconnecting client can rejoin the live turn. */
  streamRegistry: StreamRegistry;
}

/** Owns which execution, if any, holds each session. */
export interface TurnLifecycle {
  /** Take the session for a new turn. Throws `TurnInFlightError` while another lease holds it. */
  acquire(sessionId: string): TurnLease;
  /** Abort the session's executing turn. False when none is executing. */
  cancel(sessionId: string): boolean;
}

interface ActiveTurn {
  turnId: string;
  controller: AbortController;
}

const outcomeOf = (settlement: TurnSettlement) => {
  if (settlement.status === "idle") return "ended" as const;
  if (settlement.status === "failed" && settlement.incomplete) return "incomplete" as const;
  return settlement.status as "failed" | "cancelled";
};

/**
 * Build the owner of turn execution. State is process-local: a turn streams
 * in-process, so a lease cannot outlive a restart, and sessions a dead
 * process left `running` are swept to `failed` at startup.
 */
export function createTurnLifecycle(deps: TurnLifecycleDeps): TurnLifecycle {
  const { db, bus, streamRegistry } = deps;
  const active = new Map<string, ActiveTurn>();

  return {
    acquire(sessionId) {
      if (active.has(sessionId)) throw new TurnInFlightError(sessionId);
      const turnId = crypto.randomUUID();
      const controller = new AbortController();
      active.set(sessionId, { turnId, controller });
      const holds = () => active.get(sessionId)?.turnId === turnId;

      let begun = false;
      let sink: StreamSink | undefined;
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });

      const release = () => {
        sink?.close();
        active.delete(sessionId);
      };

      const lease: TurnLease = {
        turnId,
        signal: controller.signal,
        done,

        begin() {
          if (!holds()) throw new Error(`turn "${turnId}" no longer holds session "${sessionId}"`);
          setSessionStatus(db, sessionId, "running", { error: null, finishedAt: null });
          begun = true;
          bus.publish({ type: "session.updated", id: sessionId, status: "running" });
        },

        openStream(messages, transcriptRevision) {
          sink = streamRegistry.open(sessionId, messages, transcriptRevision);
          return sink;
        },

        settle(settlement) {
          if (!holds()) return;
          const { status, error, messageId } = settlement;
          const terminal = status === "failed" || status === "cancelled";
          try {
            try {
              setSessionStatus(
                db,
                sessionId,
                status,
                terminal ? { finishedAt: new Date(), ...(error ? { error } : {}) } : {},
              );
            } finally {
              release();
            }
            if (status !== "waiting") {
              bus.publish({
                type: "session.turn.settled",
                id: sessionId,
                messageId,
                outcome: outcomeOf(settlement),
              });
            }
            if (messageId !== null) bus.publish({ type: "session.message.added", sessionId });
            bus.publish({
              type: terminal ? "session.finished" : "session.updated",
              id: sessionId,
              status,
            });
          } finally {
            resolveDone();
          }
        },

        fail(cause) {
          if (!holds()) return;
          if (begun) {
            lease.settle({
              status: "failed",
              error: { message: cause instanceof Error ? cause.message : String(cause) },
              messageId: null,
            });
            return;
          }
          release();
          resolveDone();
        },
      };
      return lease;
    },

    cancel(sessionId) {
      const turn = active.get(sessionId);
      if (!turn) return false;
      turn.controller.abort();
      return true;
    },
  };
}
