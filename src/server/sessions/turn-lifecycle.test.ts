import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import { createSession, getSession, setSessionStatus } from "./store.ts";
import { type StreamRegistry, createStreamRegistry } from "./stream-registry.ts";
import {
  ShuttingDownError,
  TurnInFlightError,
  type TurnLifecycle,
  type TurnSettlement,
  createTurnLifecycle,
  settlementOutcome,
} from "./turn-lifecycle.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

describe("createTurnLifecycle", () => {
  let dir: string;
  let db: KiriDb;
  let bus: EventBus;
  let events: KiriEvent[];
  let settled: { sessionId: string; settlement: TurnSettlement; after: number }[];
  let onSettled: (sessionId: string) => void;
  let streamRegistry: StreamRegistry;
  let lifecycle: TurnLifecycle;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-turn-lifecycle-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event));
    streamRegistry = createStreamRegistry();
    settled = [];
    onSettled = () => {};
    lifecycle = createTurnLifecycle({
      db,
      bus,
      streamRegistry,
      onSettled: (sessionId, settlement) => {
        settled.push({ sessionId, settlement, after: events.length });
        onSettled(sessionId);
      },
    });
    createSession(db, MODEL, { id: "s1" });
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("holds a session for one execution at a time", () => {
    const first = lifecycle.acquire("s1");
    expect(() => lifecycle.acquire("s1")).toThrow(TurnInFlightError);

    first.begin();
    first.settle({ status: "idle", messageId: null });
    const second = lifecycle.acquire("s1");
    expect(second.turnId).not.toBe(first.turnId);
  });

  it("leaves other sessions free while one is held", () => {
    createSession(db, MODEL, { id: "s2" });
    lifecycle.acquire("s1");
    expect(() => lifecycle.acquire("s2")).not.toThrow();
  });

  it("marks the session running and clears an earlier turn's terminal markers", () => {
    setSessionStatus(db, "s1", "failed", { finishedAt: new Date(), error: { message: "boom" } });
    lifecycle.acquire("s1").begin();

    const session = getSession(db, "s1");
    expect(session?.status).toBe("running");
    expect(session?.error).toBeNull();
    expect(session?.finishedAt).toBeNull();
    expect(events).toEqual([
      {
        type: "session.updated",
        id: "s1",
        status: "running",
        projectId: null,
        parentSessionId: null,
      },
    ]);
  });

  it("aborts the executing turn on cancel, even before it has begun", () => {
    expect(lifecycle.cancel("s1")).toBe(false);
    const lease = lifecycle.acquire("s1");
    expect(lifecycle.cancel("s1")).toBe(true);
    expect(lease.signal.aborted).toBe(true);
  });

  it("settles an ended turn: idle, stream closed, events in order", async () => {
    const lease = lifecycle.acquire("s1");
    lease.begin();
    lease.openStream(0);
    events.length = 0;

    lease.settle({ status: "idle", messageId: "m1" });

    expect(getSession(db, "s1")?.status).toBe("idle");
    expect(streamRegistry.turnOf("s1")).toBeNull();
    expect(lifecycle.cancel("s1")).toBe(false);
    expect(events).toEqual([
      {
        type: "session.turn.settled",
        id: "s1",
        status: "idle",
        projectId: null,
        parentSessionId: null,
      },
      { type: "session.message.added", sessionId: "s1", projectId: null, parentSessionId: null },
      { type: "session.updated", id: "s1", status: "idle", projectId: null, parentSessionId: null },
    ]);
    await lease.done;
  });

  it("hands the settlement on once its events are out", () => {
    const lease = lifecycle.acquire("s1");
    lease.begin();
    events.length = 0;

    lease.settle({ status: "idle", messageId: "m1" });

    expect(settled).toEqual([
      { sessionId: "s1", settlement: { status: "idle", messageId: "m1" }, after: 3 },
    ]);
  });

  it("releases the session before handing the settlement on, so the next turn can start there", () => {
    const lease = lifecycle.acquire("s1");
    lease.begin();
    let replacement: string | undefined;
    onSettled = (sessionId) => {
      replacement = lifecycle.acquire(sessionId).turnId;
    };

    lease.settle({ status: "idle", messageId: null });
    expect(replacement).toBeDefined();
  });

  it("announces an approval pause as a settlement that leaves the session waiting", () => {
    const lease = lifecycle.acquire("s1");
    lease.begin();
    events.length = 0;

    lease.settle({ status: "waiting", messageId: "m1" });

    expect(getSession(db, "s1")?.status).toBe("waiting");
    expect(events).toEqual([
      {
        type: "session.turn.settled",
        id: "s1",
        status: "waiting",
        projectId: null,
        parentSessionId: null,
      },
      { type: "session.message.added", sessionId: "s1", projectId: null, parentSessionId: null },
      {
        type: "session.updated",
        id: "s1",
        status: "waiting",
        projectId: null,
        parentSessionId: null,
      },
    ]);
    expect(settled.map((entry) => entry.settlement.status)).toEqual(["waiting"]);
  });

  it("records a failure's error and finish time", () => {
    const lease = lifecycle.acquire("s1");
    lease.begin();
    events.length = 0;

    lease.settle({ status: "failed", error: { message: "provider down" }, messageId: null });

    const session = getSession(db, "s1");
    expect(session?.status).toBe("failed");
    expect(session?.error).toEqual({ message: "provider down" });
    expect(session?.finishedAt).toBeInstanceOf(Date);
    expect(events).toEqual([
      {
        type: "session.turn.settled",
        id: "s1",
        status: "failed",
        projectId: null,
        parentSessionId: null,
      },
      {
        type: "session.finished",
        id: "s1",
        status: "failed",
        projectId: null,
        parentSessionId: null,
      },
    ]);
  });

  it("announces a terminal settle as finished, whatever ended it", () => {
    const limited = lifecycle.acquire("s1");
    limited.begin();
    limited.settle({
      status: "failed",
      error: { code: "step_limit", message: "stopped" },
      messageId: "m1",
      incomplete: true,
    });
    const cancelled = lifecycle.acquire("s1");
    cancelled.begin();
    cancelled.settle({ status: "cancelled", messageId: null });

    expect(
      events.flatMap((event) => (event.type === "session.finished" ? [event.status] : [])),
    ).toEqual(["failed", "cancelled"]);
    expect(getSession(db, "s1")?.status).toBe("cancelled");
  });

  it("names how a settled turn ended", () => {
    expect(settlementOutcome({ status: "idle", messageId: "m1" })).toBe("ended");
    expect(settlementOutcome({ status: "failed", messageId: null })).toBe("failed");
    expect(settlementOutcome({ status: "failed", messageId: null, incomplete: true })).toBe(
      "incomplete",
    );
    expect(settlementOutcome({ status: "cancelled", messageId: null })).toBe("cancelled");
  });

  it("ignores a settle from a turn that no longer holds the session", () => {
    const stale = lifecycle.acquire("s1");
    stale.begin();
    stale.settle({ status: "idle", messageId: null });
    const current = lifecycle.acquire("s1");
    current.begin();
    current.openStream(0);
    events.length = 0;

    stale.settle({ status: "failed", error: { message: "late" }, messageId: null });
    stale.fail(new Error("late"));

    expect(getSession(db, "s1")?.status).toBe("running");
    expect(streamRegistry.turnOf("s1")).toBe(current.turnId);
    expect(lifecycle.cancel("s1")).toBe(true);
    expect(current.signal.aborted).toBe(true);
    expect(events).toEqual([]);
    expect(() => stale.begin()).toThrow("no longer holds");
  });

  it("releases an unbegun turn that fails without touching the session", async () => {
    const lease = lifecycle.acquire("s1");
    lease.fail(new Error("model does not resolve"));

    expect(getSession(db, "s1")?.status).toBe("idle");
    expect(events).toEqual([]);
    expect(() => lifecycle.acquire("s1")).not.toThrow();
    await lease.done;
  });

  it("settles a begun turn that fails as failed, closing its stream", async () => {
    const lease = lifecycle.acquire("s1");
    lease.begin();
    lease.openStream(0);
    events.length = 0;

    lease.fail("discovery rejected");

    expect(getSession(db, "s1")?.status).toBe("failed");
    expect(getSession(db, "s1")?.error).toEqual({ message: "discovery rejected" });
    expect(streamRegistry.turnOf("s1")).toBeNull();
    expect(events).toEqual([
      {
        type: "session.turn.settled",
        id: "s1",
        status: "failed",
        projectId: null,
        parentSessionId: null,
      },
      {
        type: "session.finished",
        id: "s1",
        status: "failed",
        projectId: null,
        parentSessionId: null,
      },
    ]);
    await lease.done;
  });

  it("still releases the session when the settling write fails", async () => {
    const lease = lifecycle.acquire("s1");
    lease.begin();
    db.$client.close();

    expect(() => lease.settle({ status: "idle", messageId: null })).toThrow();
    await lease.done;
    db = openDatabase(join(dir, "state.db"));
    expect(lifecycle.cancel("s1")).toBe(false);
  });

  it("drains by aborting every executing turn and waiting for each to settle", async () => {
    createSession(db, MODEL, { id: "s2" });
    const begun = lifecycle.acquire("s1");
    begun.begin();
    const unbegun = lifecycle.acquire("s2");

    let drained = false;
    const draining = lifecycle.drain().then(() => {
      drained = true;
    });
    expect(begun.signal.aborted).toBe(true);
    expect(unbegun.signal.aborted).toBe(true);

    begun.settle({ status: "cancelled", messageId: null });
    await Promise.resolve();
    expect(drained).toBe(false);
    unbegun.fail(new Error("never started"));
    await draining;
    expect(getSession(db, "s1")?.status).toBe("cancelled");
  });

  it("refuses every turn once draining, and drains at once with none executing", async () => {
    await lifecycle.drain();
    expect(() => lifecycle.acquire("s1")).toThrow(ShuttingDownError);
  });
});
