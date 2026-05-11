import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStep } from "../../src/server/runner/run-step.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES = join(import.meta.dir, "fixtures", "claude-code-summarizer");

interface Workspace {
  /** Tmp dir that mimics a kiri repo root: scripts/. */
  cwd: string;
  /** Per-run scratch dir (steps spawn here as cwd). */
  scratchDir: string;
  /** Where the stub claude writes captured argv/stdin. */
  captureDir: string;
  /** Dir prepended to PATH so the stub is resolved instead of a real claude. */
  binDir: string;
  /** Path to the run-context JSON the bundle reads. */
  contextFile: string;
}

/**
 * Materialise a fresh workspace: stubs claude on PATH, copies the real
 * `scripts/claude-code-summarizer/run.sh` from this repo, and pre-writes
 * a default run-context.json under the scratch dir.
 */
const setupWorkspace = (contextOverride?: unknown): Workspace => {
  const cwd = mkdtempSync(join(tmpdir(), "kiri-int-ccsum-"));
  const scratchDir = join(cwd, ".kiri", "runs", "test");
  const captureDir = join(cwd, ".kiri", "capture");
  const binDir = join(cwd, "bin");
  mkdirSync(scratchDir, { recursive: true });
  mkdirSync(captureDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const stubDst = join(binDir, "claude");
  copyFileSync(join(FIXTURES, "bin", "claude"), stubDst);
  chmodSync(stubDst, 0o755);

  const bundleDir = join(cwd, "scripts", "claude-code-summarizer");
  mkdirSync(bundleDir, { recursive: true });
  const runDst = join(bundleDir, "run.sh");
  copyFileSync(join(REPO_ROOT, "scripts", "claude-code-summarizer", "run.sh"), runDst);
  chmodSync(runDst, 0o755);

  const contextFile = join(scratchDir, "run-context.json");
  const defaultContext = {
    workflow: "demo",
    status: "ok",
    startedAt: "2026-05-10T12:00:00.000Z",
    durationMs: 1234,
    steps: [
      {
        index: 0,
        kind: "sh",
        sh: "echo hi",
        status: "ok",
        durationMs: 10,
        stdout: "hi\n",
        stderr: "",
        error: null,
      },
    ],
  };
  writeFileSync(contextFile, JSON.stringify(contextOverride ?? defaultContext, null, 2));

  return { cwd, scratchDir, captureDir, binDir, contextFile };
};

const teardownWorkspace = (ws: Workspace): void => {
  rmSync(ws.cwd, { recursive: true, force: true });
};

interface Capture {
  argv: string[];
  stdin: string;
}

const readCapture = (ws: Workspace): Capture => {
  const argc = Number(readFileSync(join(ws.captureDir, "argc"), "utf8"));
  const argv = Array.from({ length: argc }, (_, i) =>
    readFileSync(join(ws.captureDir, `arg-${i}`), "utf8"),
  );
  const stdin = readFileSync(join(ws.captureDir, "stdin"), "utf8");
  return { argv, stdin };
};

const baseEnv = (
  ws: Workspace,
  withContext: boolean,
  extra: Record<string, string> = {},
): Record<string, string> => {
  const env: Record<string, string> = {
    PATH: `${ws.binDir}:${process.env.PATH ?? ""}`,
    HOME: process.env.HOME ?? "",
    USER: process.env.USER ?? "",
    LOGNAME: process.env.LOGNAME ?? "",
    KIRI_RUN_ID: "test-run",
    KIRI_STEP_INDEX: "1",
    KIRI_REPO_ROOT: ws.cwd,
    KIRI_BUNDLE_DIR: join(ws.cwd, "scripts", "claude-code-summarizer"),
    TEST_CAPTURE_DIR: ws.captureDir,
    ...extra,
  };
  if (withContext) env.KIRI_RUN_CONTEXT_FILE = ws.contextFile;
  return env;
};

describe("claude-code-summarizer bundle: integration", () => {
  let ws: Workspace;

  afterEach(() => {
    teardownWorkspace(ws);
  });

  it("invokes claude with -p, --max-turns 1, --model haiku", async () => {
    ws = setupWorkspace();
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, true),
    });

    expect(envelope.status).toBe("ok");
    const { argv } = readCapture(ws);
    expect(argv).toHaveLength(6);
    expect(argv[0]).toBe("-p");
    expect(argv.slice(2)).toEqual(["--max-turns", "1", "--model", "haiku"]);
  });

  it("embeds the run-context JSON in the prompt", async () => {
    const context = {
      workflow: "pr-review",
      status: "ok",
      startedAt: "2026-05-10T12:00:00.000Z",
      durationMs: 5000,
      steps: [
        {
          index: 0,
          kind: "use",
          use: "fetch-pr",
          status: "ok",
          durationMs: 4000,
          stdout: "PR #42 fetched",
          stderr: "",
          error: null,
        },
      ],
    };
    ws = setupWorkspace(context);
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, true),
    });

    expect(envelope.status).toBe("ok");
    const { argv } = readCapture(ws);
    const prompt = argv[1];
    // Prompt contains the JSON envelope verbatim.
    expect(prompt).toContain('"workflow": "pr-review"');
    expect(prompt).toContain('"use": "fetch-pr"');
    expect(prompt).toContain('"stdout": "PR #42 fetched"');
    // Prompt also contains the framing instructions baked into run.sh.
    expect(prompt).toContain("activity feed");
    expect(prompt).toContain("Markdown is supported");
  });

  it("fails the step with a clear stderr when KIRI_RUN_CONTEXT_FILE is unset", async () => {
    ws = setupWorkspace();
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, false),
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.traces.stderr).toContain("KIRI_RUN_CONTEXT_FILE");
  });

  it("fails the step with a clear stderr when the context file does not exist", async () => {
    ws = setupWorkspace();
    rmSync(ws.contextFile);
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, true),
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.traces.stderr).toContain("run-context file not found");
  });

  it("fails the step with a clear stderr when claude is not on PATH", async () => {
    ws = setupWorkspace();
    const env = baseEnv(ws, true);
    // /usr/bin:/bin gives us cat without the stub claude.
    env.PATH = "/usr/bin:/bin";
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env,
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.traces.stderr).toContain("'claude'");
    expect(envelope.traces.stderr).toContain("PATH");
  });

  it("uses an inline PROMPT in place of the baked-in default", async () => {
    ws = setupWorkspace();
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, true, {
        PROMPT: "Custom inline summary, context at {{KIRI_RUN_CONTEXT_FILE}}.",
      }),
    });

    expect(envelope.status).toBe("ok");
    const { argv } = readCapture(ws);
    expect(argv[0]).toBe("-p");
    expect(argv[1]).toBe(`Custom inline summary, context at ${ws.contextFile}.`);
    // Baked-in framing must not leak through when PROMPT is set.
    expect(argv[1]).not.toContain("activity feed");
    expect(argv[1]).not.toContain('"workflow"');
    expect(argv.slice(2)).toEqual(["--max-turns", "1", "--model", "haiku"]);
  });

  it("renders a PROMPT_FILE resolved against KIRI_REPO_ROOT", async () => {
    ws = setupWorkspace();
    mkdirSync(join(ws.cwd, "prompts"), { recursive: true });
    writeFileSync(
      join(ws.cwd, "prompts", "summary.tpl"),
      "Read {{KIRI_RUN_CONTEXT_FILE}} and write one sentence.",
    );
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, true, { PROMPT_FILE: "prompts/summary.tpl" }),
    });

    expect(envelope.status).toBe("ok");
    const { argv } = readCapture(ws);
    expect(argv[1]).toBe(`Read ${ws.contextFile} and write one sentence.`);
    expect(argv[1]).not.toContain("activity feed");
  });

  it("uses PROMPT and ignores PROMPT_FILE when both are set", async () => {
    ws = setupWorkspace();
    mkdirSync(join(ws.cwd, "prompts"), { recursive: true });
    writeFileSync(join(ws.cwd, "prompts", "ignored.tpl"), "File content must not appear.");
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, true, {
        PROMPT: "Inline wins.",
        PROMPT_FILE: "prompts/ignored.tpl",
      }),
    });

    expect(envelope.status).toBe("ok");
    const { argv } = readCapture(ws);
    expect(argv[1]).toBe("Inline wins.");
    expect(argv[1]).not.toContain("File content");
  });

  it("passes the overridden MODEL to claude", async () => {
    ws = setupWorkspace();
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, true, { MODEL: "sonnet" }),
    });

    expect(envelope.status).toBe("ok");
    const { argv } = readCapture(ws);
    expect(argv.slice(-2)).toEqual(["--model", "sonnet"]);
  });

  it("passes the overridden MAX_TURNS to claude", async () => {
    ws = setupWorkspace();
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, true, { MAX_TURNS: "3" }),
    });

    expect(envelope.status).toBe("ok");
    const { argv } = readCapture(ws);
    const turnsIdx = argv.indexOf("--max-turns");
    expect(turnsIdx).toBeGreaterThanOrEqual(0);
    expect(argv[turnsIdx + 1]).toBe("3");
  });

  it("fails the step with a clear stderr when PROMPT_FILE points at a missing file", async () => {
    ws = setupWorkspace();
    const envelope = await runStep({
      step: { use: "claude-code-summarizer" },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: baseEnv(ws, true, { PROMPT_FILE: "prompts/missing.tpl" }),
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.traces.stderr).toContain("prompt file not found");
    expect(envelope.traces.stderr).toContain("prompts/missing.tpl");
  });
});
