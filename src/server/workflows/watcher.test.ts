import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  type FSWatcher,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  type watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import { loadWorkflows } from "./loader.ts";
import { createRegistry } from "./registry.ts";
import { watchWorkflows } from "./watcher.ts";

const yamlSource = (name: string, useName = name) =>
  `name: ${name}
steps:
  - use: ${useName}
`;

const writeBundle = (cwd: string, name: string): void => {
  const path = join(cwd, "scripts", name, "run.sh");
  mkdirSync(join(cwd, "scripts", name), { recursive: true });
  writeFileSync(path, "#!/bin/sh\necho hi\n");
  chmodSync(path, 0o755);
};

// Drive watcher rebuilds through an injected fs.watch fake so tests
// don't depend on real fs notification latency (FSEvents on macOS
// spikes under parallel test load). The captured listener mirrors
// node:fs.watch's contract — close() clears it, so a trigger after
// stop() is a no-op exactly as the real watcher would be.
const createFakeWatcher = () => {
  let listener: ((event: string, filename: string | null) => void) | null = null;
  const emitter = Object.assign(new EventEmitter(), {
    close: () => {
      listener = null;
    },
  }) as unknown as FSWatcher;
  const watchFn = ((
    _path: string,
    _opts: unknown,
    cb?: (event: string, filename: string | null) => void,
  ) => {
    listener = cb ?? null;
    return emitter;
  }) as unknown as typeof watch;
  const triggerChange = () => listener?.("change", null);
  return { watchFn, watcher: emitter, triggerChange };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(5);
  }
};

describe("watchWorkflows", () => {
  let cwd: string;
  let dir: string;
  let logs: string[];
  let errs: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-watch-"));
    dir = join(cwd, "workflows");
    mkdirSync(dir);
    logs = [];
    errs = [];
    origLog = console.log;
    origErr = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    rmSync(cwd, { recursive: true, force: true });
  });

  it("logs added when a new workflow file appears", async () => {
    writeBundle(cwd, "new");
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, { debounceMs: 10, watchFn });

    writeFileSync(join(dir, "new.yaml"), yamlSource("new"));
    triggerChange();
    await waitFor(() => registry.getWorkflow("new") !== undefined);

    expect(logs.some((m) => m.includes('added "new"'))).toBe(true);
    watcher.stop();
  });

  it("logs changed when an existing workflow file is edited", async () => {
    writeBundle(cwd, "v1");
    writeBundle(cwd, "v2");
    writeFileSync(join(dir, "foo.yaml"), yamlSource("foo", "v1"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, { debounceMs: 10, watchFn });

    // Ensure mtime ticks even on coarse-grained filesystems.
    await Bun.sleep(20);
    writeFileSync(join(dir, "foo.yaml"), yamlSource("foo", "v2"));
    triggerChange();

    await waitFor(() => {
      const wf = registry.getWorkflow("foo");
      return wf !== undefined && "use" in wf.steps[0] && wf.steps[0].use === "v2";
    });

    expect(logs.some((m) => m.includes('changed "foo"'))).toBe(true);
    watcher.stop();
  });

  it("logs removed when a workflow file is deleted, and stays quiet for unchanged peers", async () => {
    writeBundle(cwd, "alpha");
    writeBundle(cwd, "beta");
    writeFileSync(join(dir, "alpha.yaml"), yamlSource("alpha"));
    writeFileSync(join(dir, "beta.yaml"), yamlSource("beta"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, { debounceMs: 10, watchFn });

    unlinkSync(join(dir, "alpha.yaml"));
    triggerChange();
    await waitFor(() => registry.getWorkflow("alpha") === undefined);

    expect(logs.some((m) => m.includes('removed "alpha"'))).toBe(true);
    expect(logs.some((m) => m.includes("beta"))).toBe(false);
    expect(registry.getWorkflow("beta")).toBeDefined();
    watcher.stop();
  });

  it("logs a failure when a broken file appears, leaves healthy peers intact", async () => {
    writeBundle(cwd, "ok");
    writeFileSync(join(dir, "ok.yaml"), yamlSource("ok"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, { debounceMs: 10, watchFn });

    writeFileSync(join(dir, "bad.yaml"), "name: foo\nsteps: [\n");
    triggerChange();
    await waitFor(() => errs.length > 0);

    expect(errs[0]).toContain("failed to load");
    expect(errs[0]).toContain("bad.yaml");
    expect(registry.getWorkflow("ok")).toBeDefined();
    watcher.stop();
  });

  it("only logs each failing path once across rebuilds, and logs recovery when fixed", async () => {
    writeBundle(cwd, "ok");
    writeBundle(cwd, "bad");
    writeBundle(cwd, "ok-v2");
    writeFileSync(join(dir, "ok.yaml"), yamlSource("ok"));
    writeFileSync(join(dir, "bad.yaml"), "name: foo\nsteps: [\n");
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, { debounceMs: 10, watchFn });

    // Touching an unrelated file forces a rebuild but should not re-log
    // the still-failing bad.yaml.
    await Bun.sleep(20);
    writeFileSync(join(dir, "ok.yaml"), yamlSource("ok", "ok-v2"));
    triggerChange();
    await waitFor(() => logs.some((m) => m.includes('changed "ok"')));
    expect(errs).toEqual([]);

    // Fixing the broken file should log a recovery message and add the
    // workflow to the registry.
    writeFileSync(join(dir, "bad.yaml"), yamlSource("bad"));
    triggerChange();
    await waitFor(() => registry.getWorkflow("bad") !== undefined);

    expect(logs.some((m) => m.includes("no longer failing"))).toBe(true);
    expect(logs.some((m) => m.includes("bad.yaml"))).toBe(true);
    watcher.stop();
  });

  it("logs and survives if the workflows dir disappears mid-watch", async () => {
    writeBundle(cwd, "ok");
    writeBundle(cwd, "trigger");
    writeFileSync(join(dir, "ok.yaml"), yamlSource("ok"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const { watchFn, triggerChange } = createFakeWatcher();
    // Long debounce so the event-driven timer is comfortably pending
    // when we delete the dir; the timer then fires rebuild() against a
    // missing directory and exercises the catch.
    const watcher = watchWorkflows(dir, cwd, registry, initial, { debounceMs: 100, watchFn });

    writeFileSync(join(dir, "trigger.yaml"), yamlSource("trigger"));
    triggerChange();
    rmSync(dir, { recursive: true, force: true });

    await waitFor(() => errs.some((m) => m.includes("rebuild failed")));

    expect(errs[0]).toContain("rebuild failed");
    watcher.stop();
  });

  it("logs and schedules a rebuild when the underlying fs watcher emits an error", async () => {
    writeBundle(cwd, "alpha");
    writeFileSync(join(dir, "alpha.yaml"), yamlSource("alpha"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const { watchFn, watcher: fakeWatcher } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, { debounceMs: 10, watchFn });

    unlinkSync(join(dir, "alpha.yaml"));
    fakeWatcher.emit("error", new Error("simulated inotify hiccup"));

    await waitFor(() => registry.getWorkflow("alpha") === undefined);

    expect(errs.some((m) => m.includes("watcher error: simulated inotify hiccup"))).toBe(true);
    expect(logs.some((m) => m.includes('removed "alpha"'))).toBe(true);
    watcher.stop();
  });

  it("stringifies non-Error values from the fs watcher's error event", async () => {
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const { watchFn, watcher: fakeWatcher } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, { debounceMs: 10, watchFn });

    fakeWatcher.emit("error", "raw string");
    await waitFor(() => errs.some((m) => m.includes("raw string")));

    expect(errs.some((m) => m.includes("watcher error: raw string"))).toBe(true);
    watcher.stop();
  });

  it("publishes workflow.added when a new workflow file appears", async () => {
    writeBundle(cwd, "evt-add");
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, {
      debounceMs: 10,
      bus,
      watchFn,
    });

    writeFileSync(join(dir, "evt-add.yaml"), yamlSource("evt-add"));
    triggerChange();
    await waitFor(() => registry.getWorkflow("evt-add") !== undefined);

    expect(seen).toContainEqual({ type: "workflow.added", name: "evt-add" });
    watcher.stop();
  });

  it("publishes workflow.updated when an existing workflow file is edited", async () => {
    writeBundle(cwd, "v1");
    writeBundle(cwd, "v2");
    writeFileSync(join(dir, "evt-upd.yaml"), yamlSource("evt-upd", "v1"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, {
      debounceMs: 10,
      bus,
      watchFn,
    });

    await Bun.sleep(20);
    writeFileSync(join(dir, "evt-upd.yaml"), yamlSource("evt-upd", "v2"));
    triggerChange();
    await waitFor(() => {
      const wf = registry.getWorkflow("evt-upd");
      return wf !== undefined && "use" in wf.steps[0] && wf.steps[0].use === "v2";
    });

    expect(seen).toContainEqual({ type: "workflow.updated", name: "evt-upd" });
    watcher.stop();
  });

  it("publishes workflow.removed when a workflow file is deleted", async () => {
    writeBundle(cwd, "evt-rm");
    writeFileSync(join(dir, "evt-rm.yaml"), yamlSource("evt-rm"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, {
      debounceMs: 10,
      bus,
      watchFn,
    });

    unlinkSync(join(dir, "evt-rm.yaml"));
    triggerChange();
    await waitFor(() => registry.getWorkflow("evt-rm") === undefined);

    expect(seen).toContainEqual({ type: "workflow.removed", name: "evt-rm" });
    watcher.stop();
  });

  it("stop() halts further rebuilds", async () => {
    writeBundle(cwd, "late");
    const registry = createRegistry();
    const initial = await loadWorkflows(dir, cwd);
    registry.replace(initial.workflows);

    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchWorkflows(dir, cwd, registry, initial, { debounceMs: 10, watchFn });
    watcher.stop();

    writeFileSync(join(dir, "late.yaml"), yamlSource("late"));
    // After stop(), the fake's close() has cleared the captured listener,
    // so this trigger is a no-op — exactly as fs.watch would behave.
    triggerChange();

    expect(registry.getWorkflow("late")).toBeUndefined();
    expect(logs).toEqual([]);
  });
});
