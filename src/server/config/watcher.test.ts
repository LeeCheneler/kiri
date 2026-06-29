import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { type FSWatcher, mkdtempSync, rmSync, type watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../events/index.ts";
import { type LlmProviderRegistry, createLlmProviderRegistry } from "../llm/index.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import { loadKiriConfig } from "./loader.ts";
import { type ConfigStore, createConfigStore } from "./store.ts";
import { watchKiriConfig } from "./watcher.ts";

// Drive reloads through an injected fs.watch fake, the same approach as the
// workflow watcher tests — no dependence on real fs notification latency.
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
  const triggerChange = (filename: string | null = "kiri.yaml") => listener?.("change", filename);
  return { watchFn, watcher: emitter, triggerChange };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(5);
  }
};

const PROVIDER = "providers:\n  local:\n    type: openai-compatible\n    base_url: http://x/v1\n";

describe("watchKiriConfig", () => {
  let cwd: string;
  let config: ConfigStore;
  let registry: LlmProviderRegistry;
  let logs: string[];
  let errs: string[];
  let warns: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;
  let origWarn: typeof console.warn;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-config-watch-"));
    config = createConfigStore(cwd);
    registry = createLlmProviderRegistry();
    logs = [];
    errs = [];
    warns = [];
    origLog = console.log;
    origErr = console.error;
    origWarn = console.warn;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errs.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
    rmSync(cwd, { recursive: true, force: true });
  });

  const writeConfig = (yaml: string): void => writeFileSync(join(cwd, "kiri.yaml"), yaml);

  it("reloads providers and calls onReload when kiri.yaml changes", async () => {
    let reloaded = 0;
    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchKiriConfig(
      config,
      registry,
      {},
      {
        debounceMs: 10,
        watchFn,
        onReload: () => {
          reloaded++;
        },
      },
    );

    writeConfig(PROVIDER);
    triggerChange("kiri.yaml");
    await waitFor(() => registry.getProvider("local") !== undefined);

    expect(registry.getProvider("local")?.type).toBe("openai-compatible");
    expect(reloaded).toBe(1);
    expect(logs.some((m) => m.includes("reloaded 1 provider"))).toBe(true);
    watcher.stop();
  });

  it("reconnects mcp servers when kiri.yaml changes", async () => {
    const replaced: string[][] = [];
    const fakeMcp: McpRegistry = {
      tools: () => ({}),
      status: () => [],
      catalog: () => [],
      replace: async (servers) => {
        replaced.push([...servers.keys()]);
      },
      close: async () => {},
    };
    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchKiriConfig(
      config,
      registry,
      {},
      { debounceMs: 10, watchFn, mcpRegistry: fakeMcp },
    );

    writeConfig("mcp:\n  fs:\n    type: stdio\n    command: server\n");
    triggerChange("kiri.yaml");
    await waitFor(() => replaced.length > 0);

    expect(replaced[0]).toEqual(["fs"]);
    expect(logs.some((m) => m.includes("reloaded 1 mcp server"))).toBe(true);
    watcher.stop();
  });

  it("reacts to a null filename even without an onReload handler", async () => {
    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchKiriConfig(config, registry, {}, { debounceMs: 10, watchFn });

    writeConfig(PROVIDER);
    triggerChange(null);
    await waitFor(() => registry.getProvider("local") !== undefined);

    expect(registry.getProvider("local")).toBeDefined();
    watcher.stop();
  });

  it("ignores changes to non-config files", async () => {
    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchKiriConfig(config, registry, {}, { debounceMs: 10, watchFn });

    writeConfig(PROVIDER);
    triggerChange("kiri.md");
    // Long enough that a scheduled reload (10ms) would have fired.
    await Bun.sleep(40);

    expect(registry.getProvider("local")).toBeUndefined();
    expect(logs).toEqual([]);
    watcher.stop();
  });

  it("keeps the last-known-good registry when a reload is invalid", async () => {
    writeConfig("providers:\n  anthropic:\n    type: anthropic\n");
    registry.replace(loadKiriConfig(config, {}).providers);
    expect(registry.getProvider("anthropic")).toBeDefined();

    let reloaded = 0;
    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchKiriConfig(
      config,
      registry,
      {},
      {
        debounceMs: 10,
        watchFn,
        onReload: () => {
          reloaded++;
        },
      },
    );

    writeConfig("providers:\n  x:\n    type: not-a-real-type\n");
    triggerChange("kiri.yaml");
    await waitFor(() => errs.some((m) => m.includes("failed to load")));

    expect(registry.getProvider("anthropic")).toBeDefined();
    expect(reloaded).toBe(0);
    watcher.stop();
  });

  it("publishes config.changed on a successful reload", async () => {
    const events: string[] = [];
    const bus = createEventBus();
    bus.subscribe((e) => events.push(e.type));
    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchKiriConfig(config, registry, {}, { debounceMs: 10, watchFn, bus });

    writeConfig(PROVIDER);
    triggerChange("kiri.yaml");
    await waitFor(() => events.includes("config.changed"));

    expect(registry.getProvider("local")).toBeDefined();
    watcher.stop();
  });

  it("publishes config.changed even when the reload fails to load", async () => {
    const events: string[] = [];
    const bus = createEventBus();
    bus.subscribe((e) => events.push(e.type));
    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchKiriConfig(config, registry, {}, { debounceMs: 10, watchFn, bus });

    writeConfig("providers:\n  x:\n    type: not-a-real-type\n");
    triggerChange("kiri.yaml");
    await waitFor(() => errs.some((m) => m.includes("failed to load")));

    // The client still needs to learn of the change so it can show the error.
    expect(events).toContain("config.changed");
    watcher.stop();
  });

  it("warns when both kiri.yaml and kiri.yml exist", async () => {
    writeConfig("providers:\n  anthropic:\n    type: anthropic\n");
    writeFileSync(join(cwd, "kiri.yml"), "providers:\n  openai:\n    type: openai\n");
    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchKiriConfig(config, registry, {}, { debounceMs: 10, watchFn });

    triggerChange("kiri.yaml");
    await waitFor(() => warns.some((m) => m.includes("both")));

    expect(warns.some((m) => m.includes("kiri.yml"))).toBe(true);
    watcher.stop();
  });

  it("logs and reschedules a reload when the fs watcher emits an error", async () => {
    writeConfig(PROVIDER);
    const { watchFn, watcher: fakeWatcher } = createFakeWatcher();
    const watcher = watchKiriConfig(config, registry, {}, { debounceMs: 10, watchFn });

    fakeWatcher.emit("error", new Error("inotify hiccup"));
    await waitFor(() => registry.getProvider("local") !== undefined);

    expect(errs.some((m) => m.includes("watcher error: inotify hiccup"))).toBe(true);
    watcher.stop();
  });

  it("stringifies a non-Error watcher error", async () => {
    const { watchFn, watcher: fakeWatcher } = createFakeWatcher();
    const watcher = watchKiriConfig(config, registry, {}, { debounceMs: 10, watchFn });

    fakeWatcher.emit("error", "raw string");
    await waitFor(() => errs.some((m) => m.includes("raw string")));

    expect(errs.some((m) => m.includes("watcher error: raw string"))).toBe(true);
    watcher.stop();
  });

  it("stop() halts further reloads", async () => {
    const { watchFn, triggerChange } = createFakeWatcher();
    const watcher = watchKiriConfig(config, registry, {}, { debounceMs: 10, watchFn });
    watcher.stop();

    writeConfig(PROVIDER);
    triggerChange("kiri.yaml");
    await Bun.sleep(40);

    expect(registry.getProvider("local")).toBeUndefined();
    expect(logs).toEqual([]);
  });
});
