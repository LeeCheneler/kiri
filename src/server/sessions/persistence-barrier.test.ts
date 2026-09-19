import { describe, expect, it } from "bun:test";
import { createPersistenceBarrier } from "./persistence-barrier.ts";

// Whether `wait` has ended, observed after the microtasks already queued run.
const ended = async (wait: Promise<void>): Promise<boolean> => {
  let done = false;
  void wait.then(() => {
    done = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
};

describe("persistence barrier", () => {
  it("ends a boundary's wait once the stream processes it", async () => {
    const barrier = createPersistenceBarrier(new AbortController().signal);
    const saved = barrier.expect("work-step");

    expect(await ended(saved)).toBe(false);
    expect(barrier.settle()).toEqual({ kind: "work-step", sequence: 0 });
    expect(await ended(saved)).toBe(true);
  });

  it("settles boundaries in the order they were announced, never a later one's wait", async () => {
    const barrier = createPersistenceBarrier(new AbortController().signal);
    const summary = barrier.expect("summary");
    const step = barrier.expect("work-step");

    expect(barrier.settle()).toEqual({ kind: "summary", sequence: 0 });
    expect(await ended(summary)).toBe(true);
    expect(await ended(step)).toBe(false);

    expect(barrier.settle()).toEqual({ kind: "work-step", sequence: 1 });
    expect(await ended(step)).toBe(true);
  });

  it("ignores a processed boundary nobody announced", async () => {
    const barrier = createPersistenceBarrier(new AbortController().signal);

    expect(barrier.settle()).toBeUndefined();
    // It counts toward nothing: a gate on work steps stays shut.
    expect(await ended(barrier.processed("work-step", 1))).toBe(false);
  });

  it("holds a gate until enough boundaries of its kind are processed", async () => {
    const barrier = createPersistenceBarrier(new AbortController().signal);
    const twoSteps = barrier.processed("work-step", 2);

    void barrier.expect("work-step");
    barrier.settle();
    // A summary saves progress without being a work step.
    void barrier.expect("summary");
    barrier.settle();
    expect(await ended(twoSteps)).toBe(false);

    void barrier.expect("work-step");
    barrier.settle();
    expect(await ended(twoSteps)).toBe(true);
  });

  it("passes a gate already met, including one asking for nothing", async () => {
    const barrier = createPersistenceBarrier(new AbortController().signal);
    void barrier.expect("approval-result");
    barrier.settle();

    expect(await ended(barrier.processed("approval-result", 1))).toBe(true);
    expect(await ended(barrier.processed("work-step", 0))).toBe(true);
  });

  it("ends every pending wait when the turn is aborted", async () => {
    const controller = new AbortController();
    const barrier = createPersistenceBarrier(controller.signal);
    const notice = barrier.expect("notice");
    const gate = barrier.processed("work-step", 3);

    controller.abort();

    expect(await ended(notice)).toBe(true);
    expect(await ended(gate)).toBe(true);
    // Nothing is left announced, so a late step boundary settles nothing.
    expect(barrier.settle()).toBeUndefined();
  });

  it("never holds a wait asked for after the abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const barrier = createPersistenceBarrier(controller.signal);

    expect(await ended(barrier.expect("summary"))).toBe(true);
    expect(await ended(barrier.processed("work-step", 1))).toBe(true);
  });
});
