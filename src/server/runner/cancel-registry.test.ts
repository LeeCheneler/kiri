import { describe, expect, it } from "bun:test";
import { createCancelRegistry } from "./cancel-registry.ts";

const makeFakeChild = () => {
  const signals: (NodeJS.Signals | number)[] = [];
  return {
    signals,
    kill(signal?: NodeJS.Signals | number) {
      if (signal !== undefined) signals.push(signal);
    },
  };
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("createCancelRegistry", () => {
  it("requestCancel on an unregistered run returns false and does not register it", () => {
    const reg = createCancelRegistry();
    expect(reg.requestCancel("ghost")).toBe(false);
    expect(reg.isCancelled("ghost")).toBe(false);
  });

  it("isCancelled defaults to false for a freshly registered run", () => {
    const reg = createCancelRegistry();
    reg.register("r1");
    expect(reg.isCancelled("r1")).toBe(false);
  });

  it("requestCancel after register marks the run cancelled and returns true", () => {
    const reg = createCancelRegistry();
    reg.register("r1");
    expect(reg.requestCancel("r1")).toBe(true);
    expect(reg.isCancelled("r1")).toBe(true);
  });

  it("requestCancel sends SIGTERM to the active child", () => {
    const reg = createCancelRegistry({ sigkillDelayMs: 10_000 });
    const child = makeFakeChild();
    reg.register("r1");
    reg.setChild("r1", child);
    reg.requestCancel("r1");
    expect(child.signals).toEqual(["SIGTERM"]);
  });

  it("escalates to SIGKILL after the configured grace period", async () => {
    const reg = createCancelRegistry({ sigkillDelayMs: 20 });
    const child = makeFakeChild();
    reg.register("r1");
    reg.setChild("r1", child);
    reg.requestCancel("r1");
    await sleep(50);
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("release before the grace period elapses cancels the SIGKILL timer", async () => {
    const reg = createCancelRegistry({ sigkillDelayMs: 50 });
    const child = makeFakeChild();
    reg.register("r1");
    reg.setChild("r1", child);
    reg.requestCancel("r1");
    reg.release("r1");
    await sleep(80);
    expect(child.signals).toEqual(["SIGTERM"]);
  });

  it("requestCancel without a child set is a no-op signalling-wise but still flags cancelled", () => {
    const reg = createCancelRegistry({ sigkillDelayMs: 10 });
    reg.register("r1");
    expect(reg.requestCancel("r1")).toBe(true);
    expect(reg.isCancelled("r1")).toBe(true);
  });

  it("setChild after requestCancel signals the new child immediately", async () => {
    const reg = createCancelRegistry({ sigkillDelayMs: 20 });
    reg.register("r1");
    reg.requestCancel("r1");
    const child = makeFakeChild();
    reg.setChild("r1", child);
    expect(child.signals).toEqual(["SIGTERM"]);
    await sleep(50);
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("setChild on an unregistered run is a no-op (silently ignored)", () => {
    const reg = createCancelRegistry();
    const child = makeFakeChild();
    // No throw, no signal sent.
    reg.setChild("ghost", child);
    expect(child.signals).toEqual([]);
  });

  it("requestCancel is idempotent and does not double-signal", () => {
    const reg = createCancelRegistry({ sigkillDelayMs: 10_000 });
    const child = makeFakeChild();
    reg.register("r1");
    reg.setChild("r1", child);
    expect(reg.requestCancel("r1")).toBe(true);
    expect(reg.requestCancel("r1")).toBe(true);
    expect(child.signals).toEqual(["SIGTERM"]);
  });

  it("requestCancel after release returns false (entry was cleared)", () => {
    const reg = createCancelRegistry();
    reg.register("r1");
    reg.release("r1");
    expect(reg.requestCancel("r1")).toBe(false);
  });

  it("release on an unknown run is a no-op", () => {
    const reg = createCancelRegistry();
    // Should neither throw nor mutate any state.
    reg.release("ghost");
    expect(reg.isCancelled("ghost")).toBe(false);
  });

  it("release without a pending kill timer (no cancel was issued) is fine", () => {
    const reg = createCancelRegistry();
    reg.register("r1");
    // Releasing a run that was never cancelled hits the "no killTimer" branch.
    reg.release("r1");
    expect(reg.isCancelled("r1")).toBe(false);
  });

  it("isolates state per-run: cancelling r1 does not affect r2", () => {
    const reg = createCancelRegistry({ sigkillDelayMs: 10_000 });
    const c1 = makeFakeChild();
    const c2 = makeFakeChild();
    reg.register("r1");
    reg.register("r2");
    reg.setChild("r1", c1);
    reg.setChild("r2", c2);
    reg.requestCancel("r1");
    expect(c1.signals).toEqual(["SIGTERM"]);
    expect(c2.signals).toEqual([]);
    expect(reg.isCancelled("r1")).toBe(true);
    expect(reg.isCancelled("r2")).toBe(false);
  });
});
