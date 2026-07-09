import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { type FSWatcher, mkdirSync, mkdtempSync, rmSync, type watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import { watchPersonas } from "./personas-watcher.ts";

// Drive changes through an injected fs.watch fake, the same approach as the
// config and workflow watcher tests — no dependence on real fs latency.
const createFakeWatcher = () => {
  let listener: (() => void) | null = null;
  let closed = false;
  const emitter = Object.assign(new EventEmitter(), {
    close: () => {
      listener = null;
      closed = true;
    },
  }) as unknown as FSWatcher;
  const watchFn = ((_path: string, _opts: unknown, cb?: () => void) => {
    listener = cb ?? null;
    return emitter;
  }) as unknown as typeof watch;
  return { watchFn, emitter, trigger: () => listener?.(), isClosed: () => closed };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(5);
  }
};

describe("watchPersonas", () => {
  let cwd: string;
  let config: ConfigStore;
  let events: KiriEvent[];
  let origErr: typeof console.error;
  let errs: string[];

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-personas-"));
    config = createConfigStore(cwd);
    events = [];
    errs = [];
    origErr = console.error;
    console.error = (message: string) => errs.push(message);
  });

  afterEach(() => {
    console.error = origErr;
    rmSync(cwd, { recursive: true, force: true });
  });

  const withBus = () => {
    const bus = createEventBus();
    bus.subscribe((event) => events.push(event));
    return bus;
  };

  it("publishes persona.changed when a persona file changes", async () => {
    mkdirSync(config.personasDir());
    const { watchFn, trigger } = createFakeWatcher();
    const watcher = watchPersonas(config, { bus: withBus(), watchFn, debounceMs: 1 });

    trigger();

    await waitFor(() => events.length === 1);
    expect(events).toEqual([{ type: "persona.changed" }]);
    watcher.stop();
  });

  it("collapses a burst of changes into one publish", async () => {
    mkdirSync(config.personasDir());
    const { watchFn, trigger } = createFakeWatcher();
    const watcher = watchPersonas(config, { bus: withBus(), watchFn, debounceMs: 5 });

    trigger();
    trigger();
    trigger();

    await waitFor(() => events.length === 1);
    await Bun.sleep(20);
    expect(events).toHaveLength(1);
    watcher.stop();
  });

  it("signals a change after a watcher error so the list reconciles", async () => {
    mkdirSync(config.personasDir());
    const { watchFn, emitter } = createFakeWatcher();
    const watcher = watchPersonas(config, { bus: withBus(), watchFn, debounceMs: 1 });

    emitter.emit("error", new Error("inotify blew up"));

    await waitFor(() => events.length === 1);
    expect(errs[0]).toContain("inotify blew up");
    watcher.stop();
  });

  it("no-ops when the personas directory is absent", () => {
    const { watchFn, isClosed } = createFakeWatcher();
    const watcher = watchPersonas(config, { bus: withBus(), watchFn, debounceMs: 1 });

    watcher.stop();

    // Never attached, so there is nothing to close and nothing to publish.
    expect(isClosed()).toBe(false);
    expect(events).toEqual([]);
  });

  it("stops cleanly, dropping a pending publish and closing the watcher", async () => {
    mkdirSync(config.personasDir());
    const { watchFn, trigger, isClosed } = createFakeWatcher();
    const watcher = watchPersonas(config, { bus: withBus(), watchFn, debounceMs: 20 });

    trigger();
    watcher.stop();

    await Bun.sleep(40);
    expect(events).toEqual([]);
    expect(isClosed()).toBe(true);
  });

  it("tolerates a missing bus", async () => {
    mkdirSync(config.personasDir());
    const { watchFn, trigger } = createFakeWatcher();
    const watcher = watchPersonas(config, { watchFn, debounceMs: 1 });

    trigger();

    await Bun.sleep(20);
    watcher.stop();
  });
});
