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
  createTurnLifecycle,
} from "./turn-lifecycle.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

describe("createTurnLifecycle", () => {
  let dir: string;
  let db: KiriDb;
  let bus: EventBus;
  let events: KiriEvent[];
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
    lifecycle = createTurnLifecycle({ db, bus, streamRegistry });
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
    expect(events).toEqual([{ type: "session.updated", id: "s1", status: "running" }]);
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
    expect(streamRegistry.has("s1")).toBe(false);
    expect(lifecycle.cancel("s1")).toBe(false);
    expect(events).toEqual([
      { type: "session.turn.settled", id: "s1", messageId: "m1", outcome: "ended" },
      { type: "session.message.added", sessionId: "s1" },
      { type: "session.updated", id: "s1", status: "idle" },
    ]);
    await lease.done;
  });

  it("releases the session before publishing, so an idle event can start the next turn", () => {
    const lease = lifecycle.acquire("s1");
    lease.begin();
    let replacement: string | undefined;
    bus.subscribe((event) => {
      if (event.type === "session.updated" && event.status === "idle") {
        replacement = lifecycle.acquire("s1").turnId;
      }
    });

    lease.settle({ status: "idle", messageId: null });
    expect(replacement).toBeDefined();
  });

  it("pauses on an approval without announcing a settlement", () => {
    const lease = lifecycle.acquire("s1");
    lease.begin();
    events.length = 0;

    lease.settle({ status: "waiting", messageId: "m1" });

    expect(getSession(db, "s1")?.status).toBe("waiting");
    expect(events).toEqual([
      { type: "session.message.added", sessionId: "s1" },
      { type: "session.updated", id: "s1", status: "waiting" },
    ]);
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
      { type: "session.turn.settled", id: "s1", messageId: null, outcome: "failed" },
      { type: "session.finished", id: "s1", status: "failed" },
    ]);
  });

  it("reports a limit stop as incomplete and a cancel as cancelled", () => {
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
      events.flatMap((event) => (event.type === "session.turn.settled" ? [event.outcome] : [])),
    ).toEqual(["incomplete", "cancelled"]);
    expect(getSession(db, "s1")?.status).toBe("cancelled");
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
    expect(streamRegistry.has("s1")).toBe(true);
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
    expect(streamRegistry.has("s1")).toBe(false);
    expect(events).toEqual([
      { type: "session.turn.settled", id: "s1", messageId: null, outcome: "failed" },
      { type: "session.finished", id: "s1", status: "failed" },
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
