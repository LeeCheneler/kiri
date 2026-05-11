import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StepEnvelope, runStep } from "../../src/server/runner/run-step.ts";
import { loadWorkflows } from "../../src/server/workflows/index.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES = join(import.meta.dir, "fixtures", "claude-code");

interface Workspace {
  /** Tmp dir that mimics a kiri repo root: workflows/, prompts/, scripts/. */
  cwd: string;
  /** Per-run scratch dir (steps spawn here as cwd). */
  scratchDir: string;
  /** Where the stub claude writes captured argv/stdin. */
  captureDir: string;
  /** Dir prepended to PATH so the stub is resolved instead of a real claude. */
  binDir: string;
}

/**
 * Materialise a fresh workspace for one scenario: stubs claude on PATH,
 * copies the real `scripts/claude-code/run.sh` from this repo, and
 * stages every checked-in fixture workflow + prompt.
 */
const setupWorkspace = (): Workspace => {
  const cwd = mkdtempSync(join(tmpdir(), "kiri-int-cc-"));
  const scratchDir = join(cwd, ".kiri", "runs", "test");
  const captureDir = join(cwd, ".kiri", "capture");
  const binDir = join(cwd, "bin");
  mkdirSync(scratchDir, { recursive: true });
  mkdirSync(captureDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const stubDst = join(binDir, "claude");
  copyFileSync(join(FIXTURES, "bin", "claude"), stubDst);
  chmodSync(stubDst, 0o755);

  const bundleDir = join(cwd, "scripts", "claude-code");
  mkdirSync(bundleDir, { recursive: true });
  const runDst = join(bundleDir, "run.sh");
  copyFileSync(join(REPO_ROOT, "scripts", "claude-code", "run.sh"), runDst);
  chmodSync(runDst, 0o755);

  const wfDir = join(cwd, "workflows");
  mkdirSync(wfDir, { recursive: true });
  for (const f of readdirSync(join(FIXTURES, "workflows"))) {
    copyFileSync(join(FIXTURES, "workflows", f), join(wfDir, f));
  }
  const promptsDir = join(cwd, "prompts");
  mkdirSync(promptsDir, { recursive: true });
  for (const f of readdirSync(join(FIXTURES, "prompts"))) {
    copyFileSync(join(FIXTURES, "prompts", f), join(promptsDir, f));
  }

  return { cwd, scratchDir, captureDir, binDir };
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

/**
 * Drive a fixture workflow by name. Loads + validates it through the real
 * loader (so YAML/schema/bundle errors surface), then drives each step
 * through `runStep` with PATH stubbed to the fixture's claude. Step
 * stdout is piped into the next step's stdin to mirror the real runner's
 * pipeline behaviour.
 */
const runScenario = async (ws: Workspace, name: string): Promise<StepEnvelope[]> => {
  const result = await loadWorkflows(join(ws.cwd, "workflows"), ws.cwd);
  expect(result.failures).toEqual([]);
  const def = result.workflows.get(name);
  if (!def) throw new Error(`workflow not found in fixtures: ${name}`);

  const envelopes: StepEnvelope[] = [];
  let input = "";
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const env: Record<string, string> = {
      ...(step.env ?? {}),
      // Stub on PATH first so `claude` resolves to the capture script;
      // system PATH appended so awk/sh/cat/etc. still resolve.
      PATH: `${ws.binDir}:${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? "",
      USER: process.env.USER ?? "",
      LOGNAME: process.env.LOGNAME ?? "",
      KIRI_RUN_ID: "test-run",
      KIRI_STEP_INDEX: String(i),
      KIRI_REPO_ROOT: ws.cwd,
      TEST_CAPTURE_DIR: ws.captureDir,
    };
    if ("use" in step) env.KIRI_BUNDLE_DIR = join(ws.cwd, "scripts", step.use);
    const envelope = await runStep({
      step,
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input,
      env,
    });
    envelopes.push(envelope);
    if (envelope.status === "failed") break;
    input = envelope.output;
  }
  return envelopes;
};

describe("claude-code bundle: integration", () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = setupWorkspace();
  });

  afterEach(() => {
    teardownWorkspace(ws);
  });

  it("renders {{KIRI_INPUT}} inline for single-line stdin (no extra newline)", async () => {
    const envelopes = await runScenario(ws, "single-line-input");

    expect(envelopes.map((e) => e.status)).toEqual(["ok", "ok"]);
    const { argv } = readCapture(ws);
    expect(argv).toEqual(["-p", "Hello, Lee.", "--max-turns", "8"]);
  });

  it("preserves internal newlines when {{KIRI_INPUT}} is multi-line", async () => {
    const envelopes = await runScenario(ws, "multi-line-input");

    expect(envelopes.map((e) => e.status)).toEqual(["ok", "ok"]);
    const { argv } = readCapture(ws);
    expect(argv).toEqual(["-p", "Names:\nfirst\nsecond\nthird", "--max-turns", "8"]);
  });

  it("substitutes a custom {{VAR}} from the workflow's env block", async () => {
    const envelopes = await runScenario(ws, "custom-env");

    expect(envelopes.map((e) => e.status)).toEqual(["ok"]);
    const { argv } = readCapture(ws);
    expect(argv).toEqual(["-p", "Be cheerful.", "--max-turns", "8"]);
  });

  it("leaves {{lowercase}} placeholders literal even when an env var with that name is set", async () => {
    const envelopes = await runScenario(ws, "lowercase-literal");

    expect(envelopes.map((e) => e.status)).toEqual(["ok"]);
    const { argv } = readCapture(ws);
    // Regex is [A-Z_][A-Z0-9_]*; {{tone}} doesn't match so it survives untouched.
    expect(argv).toEqual(["-p", "Be {{tone}}.", "--max-turns", "8"]);
  });

  it("does a single-pass substitution: a value containing {{X}} is not re-scanned", async () => {
    const envelopes = await runScenario(ws, "self-referential");

    expect(envelopes.map((e) => e.status)).toEqual(["ok"]);
    const { argv } = readCapture(ws);
    // {{X}} -> "{{Y}}" once; the result is emitted as-is, never re-scanned.
    expect(argv).toEqual(["-p", "{{Y}}", "--max-turns", "8"]);
  });

  it("renders unknown {{VARS}} as empty string", async () => {
    const envelopes = await runScenario(ws, "unknown-vars");

    expect(envelopes.map((e) => e.status)).toEqual(["ok"]);
    const { argv } = readCapture(ws);
    expect(argv).toEqual(["-p", "before--after", "--max-turns", "8"]);
  });

  it("passes --model with the configured value when MODEL is set", async () => {
    const envelopes = await runScenario(ws, "model-set");

    expect(envelopes.map((e) => e.status)).toEqual(["ok"]);
    const { argv } = readCapture(ws);
    expect(argv).toEqual(["-p", "Hello.", "--max-turns", "8", "--model", "opus"]);
  });

  it("omits the --model flag when MODEL is not set", async () => {
    const envelopes = await runScenario(ws, "model-unset");

    expect(envelopes.map((e) => e.status)).toEqual(["ok"]);
    const { argv } = readCapture(ws);
    expect(argv).toEqual(["-p", "Hello.", "--max-turns", "8"]);
    expect(argv).not.toContain("--model");
  });

  it("fails the step with a clear stderr when neither PROMPT nor PROMPT_FILE is set", async () => {
    const envelopes = await runScenario(ws, "missing-prompt");

    expect(envelopes.map((e) => e.status)).toEqual(["failed"]);
    expect(envelopes[0].traces.stderr).toContain("PROMPT");
    expect(envelopes[0].traces.stderr).toContain("PROMPT_FILE");
  });

  it("renders an inline PROMPT when PROMPT_FILE is unset", async () => {
    const envelopes = await runScenario(ws, "prompt-only");

    expect(envelopes.map((e) => e.status)).toEqual(["ok"]);
    const { argv } = readCapture(ws);
    expect(argv).toEqual(["-p", "Inline prompt, no file.", "--max-turns", "8"]);
  });

  it("uses PROMPT and ignores PROMPT_FILE when both are set", async () => {
    const envelopes = await runScenario(ws, "prompt-overrides-file");

    expect(envelopes.map((e) => e.status)).toEqual(["ok", "ok"]);
    const { argv } = readCapture(ws);
    expect(argv).toEqual(["-p", "Inline wins.", "--max-turns", "8"]);
    // PROMPT_FILE points at single-line-input.tpl ("Hello, {{KIRI_INPUT}}.")
    // — its content must not leak into the rendered prompt.
    expect(argv[1]).not.toContain("Hello");
  });

  it("substitutes {{VAR}} placeholders inside an inline PROMPT", async () => {
    const envelopes = await runScenario(ws, "prompt-substitution");

    expect(envelopes.map((e) => e.status)).toEqual(["ok", "ok"]);
    const { argv } = readCapture(ws);
    expect(argv).toEqual(["-p", "Hello, Lee.", "--max-turns", "8"]);
  });

  it("fails the step with a clear stderr when claude is not on PATH", async () => {
    // Drive runStep directly with a PATH that excludes the stub bin (and
    // any real claude install). /usr/bin:/bin gives us awk + cat without
    // the bundle's external dep. The stub never runs — the bundle's own
    // dep-check fires first and exits non-zero.
    const envelope = await runStep({
      step: { use: "claude-code", env: { PROMPT_FILE: "prompts/single-line-input.tpl" } },
      cwd: ws.cwd,
      scratchDir: ws.scratchDir,
      input: "",
      env: {
        PROMPT_FILE: "prompts/single-line-input.tpl",
        PATH: "/usr/bin:/bin",
        HOME: process.env.HOME ?? "",
        USER: process.env.USER ?? "",
        LOGNAME: process.env.LOGNAME ?? "",
        KIRI_RUN_ID: "test-run",
        KIRI_STEP_INDEX: "0",
        KIRI_REPO_ROOT: ws.cwd,
        KIRI_BUNDLE_DIR: join(ws.cwd, "scripts", "claude-code"),
      },
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.traces.stderr).toContain("'claude'");
    expect(envelope.traces.stderr).toContain("PATH");
  });
});
