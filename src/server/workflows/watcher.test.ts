import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadWorkflows } from "./loader.ts";
import { createRegistry } from "./registry.ts";
import { watchWorkflows } from "./watcher.ts";

const DEFINE_PATH = resolve(import.meta.dir, "define-workflow.ts");
const NODE_MODULES = resolve(import.meta.dir, "..", "..", "..", "node_modules");

const wfSource = (name: string, scriptPath = `${name}.sh`) => `
import { z } from "zod";
import { defineWorkflow } from "${DEFINE_PATH}";

export const wf = defineWorkflow({
  name: "${name}",
  inputSchema: z.object({}),
  nodes: [{ kind: "script", path: "${scriptPath}" }],
});
`;

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(10);
  }
};

describe("watchWorkflows", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-watch-"));
    symlinkSync(NODE_MODULES, join(dir, "node_modules"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("logs added when a new workflow file appears", async () => {
    const registry = createRegistry();
    const initial = await loadWorkflows(dir);
    registry.replace(initial.workflows);
    const messages: string[] = [];

    const watcher = watchWorkflows(dir, registry, initial, {
      log: (m) => messages.push(m),
      errorLog: () => {},
      debounceMs: 10,
    });

    writeFileSync(join(dir, "new.ts"), wfSource("new"));
    await waitFor(() => registry.getWorkflow("new") !== undefined);

    expect(messages.some((m) => m.includes('added "new"'))).toBe(true);
    watcher.stop();
  });

  it("logs changed when an existing workflow file is edited", async () => {
    writeFileSync(join(dir, "foo.ts"), wfSource("foo", "v1.sh"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir);
    registry.replace(initial.workflows);
    const messages: string[] = [];

    const watcher = watchWorkflows(dir, registry, initial, {
      log: (m) => messages.push(m),
      errorLog: () => {},
      debounceMs: 10,
    });

    // Ensure mtime ticks even on coarse-grained filesystems.
    await Bun.sleep(20);
    writeFileSync(join(dir, "foo.ts"), wfSource("foo", "v2.sh"));

    await waitFor(() => {
      const wf = registry.getWorkflow("foo");
      return wf !== undefined && wf.nodes[0].kind === "script" && wf.nodes[0].path === "v2.sh";
    });

    expect(messages.some((m) => m.includes('changed "foo"'))).toBe(true);
    watcher.stop();
  });

  it("logs removed when a workflow file is deleted, and stays quiet for unchanged peers", async () => {
    writeFileSync(join(dir, "alpha.ts"), wfSource("alpha"));
    writeFileSync(join(dir, "beta.ts"), wfSource("beta"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir);
    registry.replace(initial.workflows);
    const messages: string[] = [];

    const watcher = watchWorkflows(dir, registry, initial, {
      log: (m) => messages.push(m),
      errorLog: () => {},
      debounceMs: 10,
    });

    unlinkSync(join(dir, "alpha.ts"));
    await waitFor(() => registry.getWorkflow("alpha") === undefined);

    expect(messages.some((m) => m.includes('removed "alpha"'))).toBe(true);
    expect(messages.some((m) => m.includes("beta"))).toBe(false);
    expect(registry.getWorkflow("beta")).toBeDefined();
    watcher.stop();
  });

  it("logs an error and keeps the registry intact when a rebuild fails", async () => {
    writeFileSync(join(dir, "ok.ts"), wfSource("ok"));
    const registry = createRegistry();
    const initial = await loadWorkflows(dir);
    registry.replace(initial.workflows);
    const errors: Array<[string, unknown]> = [];

    const watcher = watchWorkflows(dir, registry, initial, {
      log: () => {},
      errorLog: (m, err) => errors.push([m, err]),
      debounceMs: 10,
    });

    writeFileSync(join(dir, "bad.ts"), 'throw "boom";\n');
    await waitFor(() => errors.length > 0);

    expect(errors[0][0]).toContain("failed to reload");
    expect(registry.getWorkflow("ok")).toBeDefined();
    watcher.stop();
  });

  it("stop() halts further rebuilds", async () => {
    const registry = createRegistry();
    const initial = await loadWorkflows(dir);
    registry.replace(initial.workflows);
    const messages: string[] = [];

    const watcher = watchWorkflows(dir, registry, initial, {
      log: (m) => messages.push(m),
      errorLog: () => {},
      debounceMs: 10,
    });
    watcher.stop();

    writeFileSync(join(dir, "late.ts"), wfSource("late"));
    await Bun.sleep(80);

    expect(registry.getWorkflow("late")).toBeUndefined();
    expect(messages).toEqual([]);
  });

  it("uses console.log/console.error and DEFAULT_DEBOUNCE_MS when no options are supplied", async () => {
    const origLog = console.log;
    const origErr = console.error;
    const logs: string[] = [];
    const errs: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errs.push(args);
    };

    try {
      const registry = createRegistry();
      const initial = await loadWorkflows(dir);
      registry.replace(initial.workflows);

      const watcher = watchWorkflows(dir, registry, initial);

      writeFileSync(join(dir, "via-default.ts"), wfSource("via-default"));
      await waitFor(() => registry.getWorkflow("via-default") !== undefined, 3000);

      writeFileSync(join(dir, "broken.ts"), 'throw "kaboom";\n');
      await waitFor(() => errs.length > 0, 3000);

      watcher.stop();
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    expect(logs.some((m) => m.includes('added "via-default"'))).toBe(true);
    expect(errs.length).toBeGreaterThan(0);
  });
});
