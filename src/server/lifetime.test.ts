import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createAppLifetime } from "./lifetime.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("createAppLifetime", () => {
  let warned: ReturnType<typeof spyOn>;
  let errored: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warned = spyOn(console, "warn").mockImplementation(() => {});
    errored = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warned.mockRestore();
    errored.mockRestore();
  });

  it("stops scheduling, settles running work, then closes dependencies in order", async () => {
    const lifetime = createAppLifetime();
    const order: string[] = [];
    const turns = deferred();
    lifetime.own(
      "watchers",
      () => void order.push(`stop watchers closing=${lifetime.closing.aborted}`),
    );
    lifetime.own("turns", async () => {
      order.push("stop turns");
      await turns.promise;
      order.push("turns settled");
    });
    lifetime.onClose("mcp", async () => void order.push("close mcp"));
    lifetime.onClose("db", () => void order.push("close db"));

    expect(lifetime.closing.aborted).toBe(false);
    const done = lifetime.shutdown();
    // Every stop has been asked before anything is waited on.
    expect(order).toEqual(["stop watchers closing=true", "stop turns"]);
    turns.resolve();
    await done;
    expect(order.slice(2)).toEqual(["turns settled", "close mcp", "close db"]);
    expect(warned).not.toHaveBeenCalled();
  });

  it("waits for a tracked task without reporting a failure that is the task's own", async () => {
    const lifetime = createAppLifetime();
    const title = deferred();
    let closed = false;
    lifetime.track("a failing title", Promise.reject(new Error("provider down")));
    lifetime.track("session title", title.promise);
    lifetime.onClose("db", () => {
      closed = true;
    });

    const done = lifetime.shutdown();
    await Bun.sleep(5);
    expect(closed).toBe(false);
    title.resolve();
    await done;
    expect(closed).toBe(true);
    // A task's own failure is not the shutdown's to report.
    expect(errored).not.toHaveBeenCalled();
  });

  it("names what has not settled within the bound and closes regardless", async () => {
    const lifetime = createAppLifetime({ timeoutMs: 10 });
    let closed = false;
    lifetime.own("turns", () => new Promise<void>(() => {}));
    lifetime.own("runs", () => {});
    lifetime.track("an earlier title", Promise.resolve());
    lifetime.track("session title", new Promise(() => {}));
    lifetime.onClose("db", () => {
      closed = true;
    });

    await lifetime.shutdown();
    expect(closed).toBe(true);
    expect(warned).toHaveBeenCalledTimes(1);
    const line = String(warned.mock.calls[0]?.[0]);
    expect(line).toContain("turns, session title");
    expect(line).not.toContain("runs");
    expect(line).not.toContain("earlier");
  });

  it("carries on past an owner that fails to stop and a dependency that fails to close", async () => {
    const lifetime = createAppLifetime();
    let closed = false;
    lifetime.own("turns", () => {
      throw new Error("stop failed");
    });
    lifetime.onClose("mcp", async () => {
      throw new Error("close failed");
    });
    lifetime.onClose("db", () => {
      closed = true;
    });

    await lifetime.shutdown();
    expect(closed).toBe(true);
    expect(errored).toHaveBeenCalledTimes(2);
    expect(warned).not.toHaveBeenCalled();
  });

  it("joins the shutdown in progress on a repeated call", async () => {
    const lifetime = createAppLifetime();
    let stops = 0;
    let closes = 0;
    lifetime.own("turns", () => void stops++);
    lifetime.onClose("db", () => void closes++);

    const first = lifetime.shutdown();
    expect(lifetime.shutdown()).toBe(first);
    await first;
    await lifetime.shutdown();
    expect([stops, closes]).toEqual([1, 1]);
  });
});
