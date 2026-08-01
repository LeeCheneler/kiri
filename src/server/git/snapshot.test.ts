import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { type FSWatcher, mkdirSync, mkdtempSync, rmSync, type watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import type { GitOverview } from "./overview.ts";
import { createGitSnapshot } from "./snapshot.ts";

// The roots watcher is driven through an injected fs.watch fake and the scan
// through an injected stub, so a test controls exactly when a scan starts and
// when it finishes — no dependence on real filesystem or git latency.
const createFakeWatcher = () => {
  const listeners: Array<() => void> = [];
  let closed = 0;
  const watchFn = ((_path: string, _opts: unknown, cb?: () => void) => {
    listeners.push(cb ?? (() => {}));
    return Object.assign(new EventEmitter(), {
      close: () => {
        closed++;
      },
    }) as unknown as FSWatcher;
  }) as unknown as typeof watch;
  return { watchFn, trigger: () => listeners[0]?.(), closedCount: () => closed };
};

const createFakeScan = () => {
  const calls: string[][] = [];
  let waiters: Array<() => void> = [];
  let blocking = false;
  let failure: Error | null = null;
  const scan = async (roots: readonly string[]): Promise<GitOverview> => {
    calls.push([...roots]);
    if (blocking) await new Promise<void>((resolve) => waiters.push(resolve));
    if (failure !== null) throw failure;
    return { roots: [...roots], repos: [] };
  };
  return {
    scan,
    calls,
    block: () => {
      blocking = true;
    },
    unblock: () => {
      blocking = false;
    },
    fail: (error: Error | null) => {
      failure = error;
    },
    release: () => {
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve();
    },
  };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(5);
  }
};

describe("createGitSnapshot", () => {
  let cwd: string;
  let config: ConfigStore;
  let roots: string[];
  let events: KiriEvent[];
  let origErr: typeof console.error;
  let errs: string[];

  const writeConfig = (body: string) => writeFileSync(config.configFile(), body);

  const withRoots = (...names: string[]) =>
    writeConfig(`git:\n  roots:\n${names.map((name) => `    - ${name}\n`).join("")}`);

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-git-snapshot-"));
    config = createConfigStore(cwd);
    roots = ["one"].map((name) => join(cwd, name));
    for (const root of roots) mkdirSync(root);
    withRoots("one");
    events = [];
    errs = [];
    origErr = console.error;
    console.error = (message: string) => errs.push(message);
  });

  afterEach(() => {
    console.error = origErr;
    rmSync(cwd, { recursive: true, force: true });
  });

  const withBus = (): EventBus => {
    const bus = createEventBus();
    bus.subscribe((event) => events.push(event));
    return bus;
  };

  const gitChanged = () => events.filter((event) => event.type === "git.changed").length;

  it("serves an empty snapshot immediately and fills it when the first scan lands", async () => {
    const { watchFn } = createFakeWatcher();
    const scan = createFakeScan();
    scan.block();
    const store = createGitSnapshot(config, {}, { bus: withBus(), watchFn, scan: scan.scan });

    expect(store.current()).toEqual({ roots: [], repos: [], refreshing: true, scannedAt: null });
    expect(gitChanged()).toBe(0);

    scan.release();
    await waitFor(() => store.current().scannedAt !== null);

    const snapshot = store.current();
    expect(snapshot.roots).toEqual(roots);
    expect(snapshot.refreshing).toBe(false);
    expect(gitChanged()).toBe(1);
    store.stop();
  });

  it("serves the last completed scan while a refresh runs", async () => {
    const { watchFn } = createFakeWatcher();
    const scan = createFakeScan();
    const store = createGitSnapshot(config, {}, { bus: withBus(), watchFn, scan: scan.scan });
    await waitFor(() => store.current().scannedAt !== null);
    const settled = store.current();

    scan.block();
    const running = store.refresh();

    expect(store.current().refreshing).toBe(true);
    expect(store.current().roots).toEqual(settled.roots);
    expect(store.current().scannedAt).toBe(settled.scannedAt);

    scan.unblock();
    scan.release();
    await running;
    expect(store.current().refreshing).toBe(false);
    store.stop();
  });

  it("coalesces refreshes asked for mid-scan into a single follow-up", async () => {
    const { watchFn } = createFakeWatcher();
    const scan = createFakeScan();
    const store = createGitSnapshot(config, {}, { bus: withBus(), watchFn, scan: scan.scan });
    await waitFor(() => scan.calls.length === 1);

    scan.block();
    const first = store.refresh();
    const second = store.refresh();
    const third = store.refresh();

    scan.unblock();
    scan.release();
    await Promise.all([first, second, third]);

    // The blocked scan plus one follow-up covering all three requests — not one
    // scan each.
    expect(scan.calls).toHaveLength(3);
    expect(store.current().refreshing).toBe(false);
    store.stop();
  });

  it("rescans when the roots watcher fires", async () => {
    const { watchFn, trigger } = createFakeWatcher();
    const scan = createFakeScan();
    const store = createGitSnapshot(
      config,
      {},
      { bus: withBus(), watchFn, scan: scan.scan, debounceMs: 1 },
    );
    await waitFor(() => scan.calls.length === 1);

    trigger();

    await waitFor(() => scan.calls.length === 2);
    await waitFor(() => gitChanged() === 2);
    store.stop();
  });

  it("rescans the re-resolved roots when the config changes", async () => {
    mkdirSync(join(cwd, "two"));
    const { watchFn } = createFakeWatcher();
    const scan = createFakeScan();
    const bus = withBus();
    const store = createGitSnapshot(config, {}, { bus, watchFn, scan: scan.scan, debounceMs: 1 });
    await waitFor(() => scan.calls.length === 1);

    withRoots("one", "two");
    bus.publish({ type: "config.changed" });

    await waitFor(() => store.current().roots.length === 2);
    expect(scan.calls[1]).toEqual([...roots, join(cwd, "two")]);
    store.stop();
  });

  it("keeps the last snapshot and reports a background scan that failed", async () => {
    const { watchFn, trigger } = createFakeWatcher();
    const scan = createFakeScan();
    const store = createGitSnapshot(
      config,
      {},
      { bus: withBus(), watchFn, scan: scan.scan, debounceMs: 1 },
    );
    await waitFor(() => store.current().scannedAt !== null);
    const settled = store.current();

    scan.fail(new Error("git went missing"));
    trigger();

    await waitFor(() => errs.length === 1);
    expect(errs[0]).toContain("git went missing");
    expect(store.current()).toEqual(settled);
    // A failed scan must not leave the view pinned to "refreshing" forever.
    expect(store.current().refreshing).toBe(false);
    store.stop();
  });

  it("rejects to the caller when an explicit refresh fails", async () => {
    const { watchFn } = createFakeWatcher();
    const scan = createFakeScan();
    const store = createGitSnapshot(config, {}, { bus: withBus(), watchFn, scan: scan.scan });
    await waitFor(() => store.current().scannedAt !== null);

    scan.fail(new Error("git went missing"));
    expect(store.refresh()).rejects.toThrow("git went missing");
    store.stop();
  });

  it("works without an event bus", async () => {
    const { watchFn } = createFakeWatcher();
    const scan = createFakeScan();
    const store = createGitSnapshot(config, {}, { watchFn, scan: scan.scan });

    await waitFor(() => store.current().scannedAt !== null);
    store.stop();
  });

  it("stops following the roots once stopped", async () => {
    const { watchFn, closedCount } = createFakeWatcher();
    const scan = createFakeScan();
    const bus = withBus();
    const store = createGitSnapshot(config, {}, { bus, watchFn, scan: scan.scan, debounceMs: 1 });
    await waitFor(() => scan.calls.length === 1);

    store.stop();
    withRoots("one", "two");
    bus.publish({ type: "config.changed" });

    await Bun.sleep(20);
    expect(scan.calls).toHaveLength(1);
    expect(closedCount()).toBe(1);
  });
});
