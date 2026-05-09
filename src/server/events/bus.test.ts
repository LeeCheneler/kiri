import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type KiriEvent, createEventBus } from "./bus.ts";

describe("createEventBus", () => {
  let errs: string[];
  let origErr: typeof console.error;

  beforeEach(() => {
    errs = [];
    origErr = console.error;
    console.error = (...args: unknown[]) => {
      errs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.error = origErr;
  });

  it("delivers a published event to a subscriber", () => {
    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    bus.publish({ type: "run.started", id: "r1" });

    expect(seen).toEqual([{ type: "run.started", id: "r1" }]);
  });

  it("delivers each event to every subscriber", () => {
    const bus = createEventBus();
    const a: KiriEvent[] = [];
    const b: KiriEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.publish({ type: "workflow.added", name: "wf" });

    expect(a).toEqual([{ type: "workflow.added", name: "wf" }]);
    expect(b).toEqual([{ type: "workflow.added", name: "wf" }]);
  });

  it("stops delivering after a subscriber unsubscribes", () => {
    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));

    bus.publish({ type: "run.started", id: "r1" });
    off();
    bus.publish({ type: "run.started", id: "r2" });

    expect(seen).toEqual([{ type: "run.started", id: "r1" }]);
  });

  it("treats a second unsubscribe call as a no-op", () => {
    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    off();
    off();

    bus.publish({ type: "run.started", id: "r1" });

    expect(seen).toEqual([]);
  });

  it("isolates subscriber throws so later subscribers still receive the event", () => {
    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe((e) => seen.push(e));

    bus.publish({ type: "run.started", id: "r1" });

    expect(seen).toEqual([{ type: "run.started", id: "r1" }]);
    expect(errs.some((m) => m.includes("listener threw on run.started: boom"))).toBe(true);
  });

  it("stringifies non-Error throws from subscribers", () => {
    const bus = createEventBus();
    bus.subscribe(() => {
      throw "raw string";
    });

    bus.publish({ type: "run.started", id: "r1" });

    expect(errs.some((m) => m.includes("listener threw on run.started: raw string"))).toBe(true);
  });

  it("allows a subscriber to unsubscribe itself during dispatch without skipping peers", () => {
    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    const off = bus.subscribe(() => off());
    bus.subscribe((e) => seen.push(e));

    bus.publish({ type: "run.started", id: "r1" });
    bus.publish({ type: "run.started", id: "r2" });

    // Both publishes reach the second subscriber; the self-unsubscribing
    // one only fires once.
    expect(seen).toEqual([
      { type: "run.started", id: "r1" },
      { type: "run.started", id: "r2" },
    ]);
  });

  it("narrows event payloads on type discrimination", () => {
    const bus = createEventBus();
    let workflowName: string | undefined;
    bus.subscribe((e) => {
      if (e.type === "run.finished") workflowName = e.workflowName;
    });

    bus.publish({ type: "run.finished", id: "r1", status: "ok", workflowName: "deploy" });

    expect(workflowName).toBe("deploy");
  });
});
