import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { type FSWatcher, mkdirSync, mkdtempSync, rmSync, type watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import { watchWorktreeRoots } from "./roots-watcher.ts";

// Drive changes through an injected fs.watch fake, the same approach as the
// config and persona watcher tests — no dependence on real fs latency.
const createFakeWatcher = () => {
  const attached: string[] = [];
  const listeners: Array<() => void> = [];
  const emitters: FSWatcher[] = [];
  let closed = 0;
  const watchFn = ((path: string, _opts: unknown, cb?: () => void) => {
    attached.push(path);
    listeners.push(cb ?? (() => {}));
    const emitter = Object.assign(new EventEmitter(), {
      close: () => {
        closed++;
      },
    }) as unknown as FSWatcher;
    emitters.push(emitter);
    return emitter;
  }) as unknown as typeof watch;
  return {
    watchFn,
    attached,
    emitters,
    trigger: (index = 0) => listeners[index]?.(),
    closedCount: () => closed,
  };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(5);
  }
};

describe("watchWorktreeRoots", () => {
  let base: string;
  let roots: string[];
  let events: KiriEvent[];
  let origErr: typeof console.error;
  let errs: string[];

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "kiri-worktree-watch-"));
    roots = [join(base, "one"), join(base, "two")];
    for (const root of roots) mkdirSync(root);
    events = [];
    errs = [];
    origErr = console.error;
    console.error = (message: string) => errs.push(message);
  });

  afterEach(() => {
    console.error = origErr;
    rmSync(base, { recursive: true, force: true });
  });

  const withBus = () => {
    const bus = createEventBus();
    bus.subscribe((event) => events.push(event));
    return bus;
  };

  it("publishes git.changed when a root changes", async () => {
    const { watchFn, trigger, attached } = createFakeWatcher();
    const watcher = watchWorktreeRoots(roots, { bus: withBus(), watchFn, debounceMs: 1 });

    expect(attached).toEqual(roots);
    trigger(1);

    await waitFor(() => events.length === 1);
    expect(events).toEqual([{ type: "git.changed" }]);
    watcher.stop();
  });

  it("collapses a burst across roots into one publish", async () => {
    const { watchFn, trigger } = createFakeWatcher();
    const watcher = watchWorktreeRoots(roots, { bus: withBus(), watchFn, debounceMs: 5 });

    trigger(0);
    trigger(0);
    trigger(1);

    await waitFor(() => events.length === 1);
    await Bun.sleep(20);
    expect(events).toHaveLength(1);
    watcher.stop();
  });

  it("signals a change after a watcher error so the model reconciles", async () => {
    const { watchFn, emitters } = createFakeWatcher();
    const watcher = watchWorktreeRoots(roots, { bus: withBus(), watchFn, debounceMs: 1 });

    emitters[0].emit("error", new Error("inotify blew up"));

    await waitFor(() => events.length === 1);
    expect(errs[0]).toContain("inotify blew up");
    watcher.stop();
  });

  it("skips roots that do not exist", () => {
    const { watchFn, attached } = createFakeWatcher();
    const watcher = watchWorktreeRoots([roots[0], join(base, "missing")], {
      bus: withBus(),
      watchFn,
    });

    expect(attached).toEqual([roots[0]]);
    watcher.stop();
  });

  it("no-ops with no roots configured", async () => {
    const { watchFn, attached } = createFakeWatcher();
    const watcher = watchWorktreeRoots([], { bus: withBus(), watchFn, debounceMs: 1 });

    await Bun.sleep(10);
    expect(attached).toEqual([]);
    expect(events).toEqual([]);
    watcher.stop();
  });

  it("stops cleanly, dropping a pending publish and closing every watcher", async () => {
    const { watchFn, trigger, closedCount } = createFakeWatcher();
    const watcher = watchWorktreeRoots(roots, { bus: withBus(), watchFn, debounceMs: 20 });

    trigger(0);
    watcher.stop();

    await Bun.sleep(40);
    expect(events).toEqual([]);
    expect(closedCount()).toBe(2);
  });

  it("tolerates a missing bus", async () => {
    const { watchFn, trigger } = createFakeWatcher();
    const watcher = watchWorktreeRoots(roots, { watchFn, debounceMs: 1 });

    trigger(0);

    await Bun.sleep(20);
    watcher.stop();
  });
});
