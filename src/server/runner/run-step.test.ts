import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import type { ChildHandle } from "./cancel-registry.ts";
import { runStep } from "./run-step.ts";

describe("runStep", () => {
  let cwd: string;
  let config: ConfigStore;
  let scratchDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-step-"));
    config = createConfigStore(cwd);
    scratchDir = join(cwd, "scratch");
    mkdirSync(scratchDir);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const writeBundle = (name: string, body: string): void => {
    const bundleDir = join(cwd, "bundles", name);
    mkdirSync(bundleDir, { recursive: true });
    const path = join(bundleDir, "run.sh");
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  };

  describe("use: steps", () => {
    it("returns an ok envelope when the bundle's run.sh exits 0", async () => {
      writeBundle("ok", "#!/bin/sh\necho hello\n");

      const envelope = await runStep({
        step: { use: "ok" },
        config,
        scratchDir,
        input: "",
        env: {},
      });

      expect(envelope.status).toBe("ok");
      expect(envelope.output).toBe("hello\n");
      expect(envelope.traces.stdout).toBe("hello\n");
      expect(envelope.traces.stderr).toBe("");
      expect(envelope.error).toBeUndefined();
      expect(envelope.traces.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns a failed envelope when the bundle exits non-zero", async () => {
      writeBundle("fail", "#!/bin/sh\necho boom\nexit 7\n");

      const envelope = await runStep({
        step: { use: "fail" },
        config,
        scratchDir,
        input: "",
        env: {},
      });

      expect(envelope.status).toBe("failed");
      expect(envelope.error?.message).toContain("7");
      expect(envelope.traces.stdout).toBe("boom\n");
    });

    it("captures stderr separately from stdout", async () => {
      writeBundle("err", "#!/bin/sh\necho out\necho err 1>&2\n");

      const envelope = await runStep({
        step: { use: "err" },
        config,
        scratchDir,
        input: "",
        env: {},
      });

      expect(envelope.traces.stdout).toBe("out\n");
      expect(envelope.traces.stderr).toBe("err\n");
    });

    it("pipes input into the bundle's stdin", async () => {
      writeBundle("cat", "#!/bin/sh\ncat\n");

      const envelope = await runStep({
        step: { use: "cat" },
        config,
        scratchDir,
        input: "echo me back",
        env: {},
      });

      expect(envelope.output).toBe("echo me back");
    });

    it("runs the bundle with cwd set to the scratch dir", async () => {
      writeBundle("pwd", "#!/bin/sh\npwd\n");

      const envelope = await runStep({
        step: { use: "pwd" },
        config,
        scratchDir,
        input: "",
        env: {},
      });

      // pwd resolves the path; on macOS /var/folders is a symlink to /private/var/folders.
      expect(envelope.output.trim()).toBe(realpathSync(scratchDir));
    });

    it("only exposes env vars that were explicitly passed (no parent inheritance)", async () => {
      // USER and HOME are set in the test process's env. If scoping works,
      // the child sees neither — only FOO comes through.
      expect(process.env.USER).toBeTruthy();
      expect(process.env.HOME).toBeTruthy();
      writeBundle("env", '#!/bin/sh\necho "FOO=$FOO USER=$USER HOME=$HOME"\n');

      const envelope = await runStep({
        step: { use: "env" },
        config,
        scratchDir,
        input: "",
        env: { FOO: "bar" },
      });

      expect(envelope.status).toBe("ok");
      expect(envelope.output.trim()).toBe("FOO=bar USER= HOME=");
    });

    it("returns a failed envelope when the bundle script does not exist", async () => {
      const envelope = await runStep({
        step: { use: "missing" },
        config,
        scratchDir,
        input: "",
        env: {},
      });

      expect(envelope.status).toBe("failed");
      expect(envelope.error).toBeDefined();
    });
  });

  describe("onSpawn callback", () => {
    it("invokes onSpawn synchronously with the live subprocess handle", async () => {
      const captured: ChildHandle[] = [];
      const envelope = await runStep({
        step: { sh: "echo hi" },
        config,
        scratchDir,
        input: "",
        env: {},
        onSpawn: (proc) => captured.push(proc),
      });

      expect(envelope.status).toBe("ok");
      expect(captured).toHaveLength(1);
      // ChildHandle shape: a `kill` method the cancel registry will call.
      expect(typeof captured[0].kill).toBe("function");
    });
  });

  describe("sh: steps", () => {
    it("runs an inline shell snippet via sh -c and reports ok on exit 0", async () => {
      const envelope = await runStep({
        step: { sh: "echo from-sh" },
        config,
        scratchDir,
        input: "",
        env: {},
      });

      expect(envelope.status).toBe("ok");
      expect(envelope.output).toBe("from-sh\n");
    });

    it("returns a failed envelope on non-zero exit", async () => {
      const envelope = await runStep({
        step: { sh: "echo bye; exit 3" },
        config,
        scratchDir,
        input: "",
        env: {},
      });

      expect(envelope.status).toBe("failed");
      expect(envelope.error?.message).toContain("3");
      expect(envelope.traces.stdout).toBe("bye\n");
    });

    it("pipes input into the inline snippet's stdin", async () => {
      const envelope = await runStep({
        step: { sh: "cat" },
        config,
        scratchDir,
        input: "piped",
        env: {},
      });

      expect(envelope.output).toBe("piped");
    });

    it("fails cleanly when the env exceeds the exec size limit, naming the largest entry", async () => {
      const envelope = await runStep({
        step: { sh: "echo never-runs" },
        config,
        scratchDir,
        input: "",
        env: { BIG: "x".repeat(950 * 1024), SMALL: "tiny" },
      });

      expect(envelope.status).toBe("failed");
      expect(envelope.error?.message).toContain("exec limit");
      expect(envelope.error?.message).toContain("BIG (950 KB)");
      // The child was never spawned.
      expect(envelope.traces.stdout).toBe("");
    });

    it("uses scratchDir as cwd", async () => {
      const envelope = await runStep({
        step: { sh: "pwd" },
        config,
        scratchDir,
        input: "",
        env: {},
      });

      expect(envelope.output.trim()).toBe(realpathSync(scratchDir));
    });

    it("scopes env to exactly what was passed", async () => {
      const envelope = await runStep({
        step: { sh: 'echo "FOO=$FOO USER=$USER"' },
        config,
        scratchDir,
        input: "",
        env: { FOO: "bar" },
      });

      expect(envelope.output.trim()).toBe("FOO=bar USER=");
    });
  });

  describe("llm: steps", () => {
    it("dispatches to the llm executor instead of spawning", async () => {
      const envelope = await runStep({
        step: { llm: { model: "anthropic:claude-haiku-4-5", prompt: "Summarise {{KIRI_INPUT}}" } },
        config,
        scratchDir,
        input: "the news\n",
        env: {},
        llmClients: {
          resolveModel: () => {
            throw new Error("unused");
          },
          resolveImageModel: () => {
            throw new Error("unused");
          },
          generateText: async ({ prompt }) => ({ text: `completed: ${prompt}`, usage: {} }),
          listModels: async () => ({ models: [], failures: [] }),
          contextWindowFor: async () => undefined,
        },
      });

      expect(envelope.status).toBe("ok");
      expect(envelope.output).toBe("completed: Summarise the news");
    });

    it("returns a failed envelope when no llm clients are configured", async () => {
      const envelope = await runStep({
        step: { llm: { model: "anthropic:claude-haiku-4-5", prompt: "Summarise." } },
        config,
        scratchDir,
        input: "",
        env: {},
      });

      expect(envelope.status).toBe("failed");
      expect(envelope.output).toBe("");
      expect(envelope.error?.message).toContain("anthropic:claude-haiku-4-5");
    });
  });
});
