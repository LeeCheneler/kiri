import { describe, expect, it } from "bun:test";
import { createLimiter } from "./limit-concurrency.ts";

// A task whose completion the test controls, reporting when it was started.
const deferred = () => {
  let resolve: (value: string) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  let started = false;
  return {
    resolve,
    reject,
    get started() {
      return started;
    },
    task: () => {
      started = true;
      return promise;
    },
  };
};

// Let every already-resolved continuation run before asserting.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createLimiter", () => {
  it("runs tasks straight away while slots are free", async () => {
    const limit = createLimiter(2);
    const [one, two] = [deferred(), deferred()];

    const results = Promise.all([limit(one.task), limit(two.task)]);
    await settle();
    expect([one.started, two.started]).toEqual([true, true]);

    one.resolve("one");
    two.resolve("two");
    expect(await results).toEqual(["one", "two"]);
  });

  it("holds a task back until a running one finishes", async () => {
    const limit = createLimiter(1);
    const [first, second] = [deferred(), deferred()];

    const results = Promise.all([limit(first.task), limit(second.task)]);
    await settle();
    expect(second.started).toBe(false);

    first.resolve("first");
    await settle();
    expect(second.started).toBe(true);

    second.resolve("second");
    expect(await results).toEqual(["first", "second"]);
  });

  it("frees the slot when a task throws, and surfaces the error to its caller", async () => {
    const limit = createLimiter(1);
    const [failing, next] = [deferred(), deferred()];

    const attempt = limit(failing.task);
    const queued = limit(next.task);
    failing.reject(new Error("no patch"));

    await expect(attempt).rejects.toThrow("no patch");
    await settle();
    expect(next.started).toBe(true);

    next.resolve("next");
    expect(await queued).toBe("next");
  });
});
