import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { type FSWatcher, mkdirSync, mkdtempSync, rmSync, type watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import { type EventBus, createEventBus } from "../events/index.ts";
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
  let cwd: string;
  let config: ConfigStore;
  let roots: string[];
  let signals: number;
  let origErr: typeof console.error;
  let errs: string[];

  const writeConfig = (body: string) => writeFileSync(config.configFile(), body);

  const withRoots = (...names: string[]) =>
    writeConfig(`git:\n  roots:\n${names.map((name) => `    - ${name}\n`).join("")}`);

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-worktree-watch-"));
    config = createConfigStore(cwd);
    roots = ["one", "two"].map((name) => join(cwd, name));
    for (const root of roots) mkdirSync(root);
    withRoots("one", "two");
    signals = 0;
    errs = [];
    origErr = console.error;
    console.error = (message: string) => errs.push(message);
  });

  afterEach(() => {
    console.error = origErr;
    rmSync(cwd, { recursive: true, force: true });
  });

  const withBus = (): EventBus => createEventBus();

  const onChanged = () => {
    signals++;
  };

  it("signals when a root changes", async () => {
    const { watchFn, trigger, attached } = createFakeWatcher();
    const watcher = watchWorktreeRoots(config, {}, { onChanged, watchFn, debounceMs: 1 });

    expect(attached).toEqual(roots);
    expect(watcher.roots()).toEqual(roots);
    trigger(1);

    await waitFor(() => signals === 1);
    watcher.stop();
  });

  it("collapses a burst across roots into one signal", async () => {
    const { watchFn, trigger } = createFakeWatcher();
    const watcher = watchWorktreeRoots(config, {}, { onChanged, watchFn, debounceMs: 5 });

    trigger(0);
    trigger(0);
    trigger(1);

    await waitFor(() => signals === 1);
    await Bun.sleep(20);
    expect(signals).toBe(1);
    watcher.stop();
  });

  it("signals a change after a watcher error so the model reconciles", async () => {
    const { watchFn, emitters } = createFakeWatcher();
    const watcher = watchWorktreeRoots(config, {}, { onChanged, watchFn, debounceMs: 1 });

    emitters[0].emit("error", new Error("inotify blew up"));

    await waitFor(() => signals === 1);
    expect(errs[0]).toContain("inotify blew up");
    watcher.stop();
  });

  it("skips roots that do not exist", () => {
    withRoots("one", "missing");
    const { watchFn, attached } = createFakeWatcher();
    const watcher = watchWorktreeRoots(config, {}, { onChanged, watchFn });

    expect(attached).toEqual([roots[0]]);
    watcher.stop();
  });

  it("no-ops with no roots configured", async () => {
    rmSync(config.configFile());
    const { watchFn, attached } = createFakeWatcher();
    const watcher = watchWorktreeRoots(config, {}, { onChanged, watchFn, debounceMs: 1 });

    await Bun.sleep(10);
    expect(attached).toEqual([]);
    expect(watcher.roots()).toEqual([]);
    expect(signals).toBe(0);
    watcher.stop();
  });

  it("stops cleanly, dropping a pending signal and closing every watcher", async () => {
    const { watchFn, trigger, closedCount } = createFakeWatcher();
    const watcher = watchWorktreeRoots(config, {}, { onChanged, watchFn, debounceMs: 20 });

    trigger(0);
    watcher.stop();

    await Bun.sleep(40);
    expect(signals).toBe(0);
    expect(closedCount()).toBe(2);
  });

  it("tolerates a missing bus and no listener", async () => {
    const { watchFn, trigger } = createFakeWatcher();
    const watcher = watchWorktreeRoots(config, {}, { watchFn, debounceMs: 1 });

    trigger(0);

    await Bun.sleep(20);
    watcher.stop();
  });

  describe("on config.changed", () => {
    it("re-arms over an added root and announces the new shape", () => {
      const bus = withBus();
      const { watchFn, attached, closedCount } = createFakeWatcher();
      const watcher = watchWorktreeRoots(config, {}, { bus, onChanged, watchFn, debounceMs: 1 });

      mkdirSync(join(cwd, "three"));
      withRoots("one", "two", "three");
      bus.publish({ type: "config.changed" });

      expect(attached).toEqual([...roots, ...roots, join(cwd, "three")]);
      expect(watcher.roots()).toEqual([...roots, join(cwd, "three")]);
      expect(closedCount()).toBe(2);
      expect(signals).toBe(1);
      watcher.stop();
    });

    it("re-arms over a removed root", () => {
      const bus = withBus();
      const { watchFn, attached } = createFakeWatcher();
      const watcher = watchWorktreeRoots(config, {}, { bus, onChanged, watchFn, debounceMs: 1 });

      withRoots("one");
      bus.publish({ type: "config.changed" });

      expect(attached).toEqual([...roots, roots[0]]);
      watcher.stop();
    });

    it("clears the roots when the git section is deleted", () => {
      const bus = withBus();
      const { watchFn, attached, closedCount } = createFakeWatcher();
      const watcher = watchWorktreeRoots(config, {}, { bus, onChanged, watchFn, debounceMs: 1 });

      writeConfig("providers: {}\n");
      bus.publish({ type: "config.changed" });

      expect(attached).toEqual(roots);
      expect(watcher.roots()).toEqual([]);
      expect(closedCount()).toBe(2);
      expect(signals).toBe(1);
      watcher.stop();
    });

    it("keeps the current roots when the config fails to load", () => {
      const bus = withBus();
      const { watchFn, attached, closedCount } = createFakeWatcher();
      const watcher = watchWorktreeRoots(config, {}, { bus, onChanged, watchFn, debounceMs: 1 });

      writeConfig("git:\n  roots: not-a-list\n");
      bus.publish({ type: "config.changed" });

      expect(attached).toEqual(roots);
      expect(watcher.roots()).toEqual(roots);
      expect(closedCount()).toBe(0);
      expect(signals).toBe(0);
      watcher.stop();
    });

    it("leaves the watchers alone when the roots are unchanged", () => {
      const bus = withBus();
      const { watchFn, attached, closedCount } = createFakeWatcher();
      const watcher = watchWorktreeRoots(config, {}, { bus, onChanged, watchFn, debounceMs: 1 });

      bus.publish({ type: "config.changed" });

      expect(attached).toEqual(roots);
      expect(closedCount()).toBe(0);
      expect(signals).toBe(0);
      watcher.stop();
    });

    it("ignores unrelated events", () => {
      const bus = withBus();
      const { watchFn, attached } = createFakeWatcher();
      const watcher = watchWorktreeRoots(config, {}, { bus, onChanged, watchFn, debounceMs: 1 });

      withRoots("one");
      bus.publish({ type: "persona.changed" });

      expect(attached).toEqual(roots);
      watcher.stop();
    });

    it("stops re-resolving once stopped", () => {
      const bus = withBus();
      const { watchFn, attached } = createFakeWatcher();
      const watcher = watchWorktreeRoots(config, {}, { bus, onChanged, watchFn, debounceMs: 1 });
      watcher.stop();

      withRoots("one");
      bus.publish({ type: "config.changed" });

      expect(attached).toEqual(roots);
    });
  });
});
