/**
 * What a step boundary written into a turn's stream carries: a finished work
 * step, the result of an approval the turn resumed, a context summary, or the
 * notice that the turn stopped at a limit.
 */
export type BoundaryKind = "work-step" | "approval-result" | "summary" | "notice";

/** One boundary of one turn: its kind, and its place among the turn's boundaries. */
export interface PersistenceBoundary {
  kind: BoundaryKind;
  sequence: number;
}

/**
 * Coordinates a turn's model execution with the saving of its progress. The
 * two run on different timelines — the model loop can prepare its next call
 * before the stream has saved the step it just finished — so whatever writes
 * a boundary into the stream announces it here first, and whatever must not
 * outrun saved work waits here for it.
 */
export interface PersistenceBarrier {
  /**
   * Announce a boundary about to be written into the stream. Call before the
   * write: the stream can process it synchronously. The wait ends once that
   * boundary is processed.
   */
  expect(kind: BoundaryKind): Promise<void>;
  /**
   * The stream processed its oldest announced boundary — boundaries are
   * processed in the order written. Returns the boundary, or undefined for
   * one nobody announced, which is ignored.
   */
  settle(): PersistenceBoundary | undefined;
  /** Wait until `count` boundaries of `kind` have been processed. */
  processed(kind: BoundaryKind, count: number): Promise<void>;
}

/**
 * Create the barrier for one turn, released by `signal`. A turn that is
 * cancelled, or whose save failed, never processes what it was waiting for:
 * aborting ends every wait, pending or later, so nothing hangs. A wait ending
 * is therefore not proof of a save — the waiter checks the signal before
 * relying on one.
 */
export function createPersistenceBarrier(signal: AbortSignal): PersistenceBarrier {
  const announced: { boundary: PersistenceBoundary; resolve: () => void }[] = [];
  const gates: { kind: BoundaryKind; count: number; resolve: () => void }[] = [];
  const counts = new Map<BoundaryKind, number>();
  let sequence = 0;

  const openGates = (open: (gate: (typeof gates)[number]) => boolean) => {
    for (const gate of gates.filter(open)) {
      gates.splice(gates.indexOf(gate), 1);
      gate.resolve();
    }
  };

  signal.addEventListener(
    "abort",
    () => {
      for (const { resolve } of announced.splice(0)) resolve();
      openGates(() => true);
    },
    { once: true },
  );

  return {
    expect: (kind) => {
      if (signal.aborted) return Promise.resolve();
      const boundary = { kind, sequence };
      sequence += 1;
      return new Promise((resolve) => {
        announced.push({ boundary, resolve });
      });
    },
    settle: () => {
      const head = announced.shift();
      if (head === undefined) return undefined;
      const { kind } = head.boundary;
      const count = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, count);
      head.resolve();
      openGates((gate) => gate.kind === kind && gate.count <= count);
      return head.boundary;
    },
    processed: (kind, count) => {
      if (signal.aborted || (counts.get(kind) ?? 0) >= count) return Promise.resolve();
      return new Promise((resolve) => {
        gates.push({ kind, count, resolve });
      });
    },
  };
}
