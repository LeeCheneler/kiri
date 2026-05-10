import { type WorkflowStep, bundleRunPath, isUseStep } from "../workflows/index.ts";

/**
 * Standard envelope for a step, matching the shape every step variant
 * returns. `output` is the captured stdout; for a multi-step pipeline the
 * runner pipes this into the next step's stdin.
 */
export interface StepEnvelope {
  status: "ok" | "failed";
  output: string;
  error?: { message: string; stack?: string };
  traces: { stdout: string; stderr: string; durationMs: number };
}

export interface RunStepArgs {
  /** The validated workflow step — either a `use:` bundle reference or an inline `sh:` snippet. */
  step: WorkflowStep;
  /** Repo root. Used to resolve `use:` bundles to `<cwd>/scripts/<name>/run.sh`. */
  cwd: string;
  /** Working directory for the spawned process — typically a per-run scratch dir. */
  scratchDir: string;
  /** Bytes piped to the step's stdin. Pass `""` for the first step in a pipeline. */
  input: string;
  /**
   * Scoped env vars exposed to the step. No parent-process inheritance —
   * pass exactly what the step should see. Empty object means an empty env.
   */
  env: Record<string, string>;
  /**
   * Invoked synchronously after the child is spawned, with the live
   * subprocess handle. The runner uses this to publish the handle to the
   * cancel registry so an in-flight cancel can SIGTERM/SIGKILL the child.
   */
  onSpawn?: (proc: Bun.Subprocess) => void;
}

/**
 * Spawn a workflow step and assemble the standard envelope.
 *
 * `use:` steps spawn the bundle's `run.sh` directly (`[runPath]`); `sh:`
 * steps spawn `["sh", "-c", inline]`. Both use the explicit argv form —
 * no shell interpolation of any input. Caller controls `cwd`
 * (scratchDir) and the env scope. Spawn-time failure (missing script,
 * not executable) and a non-zero exit both yield `status: "failed"`
 * with the cause in `error`.
 */
export async function runStep(args: RunStepArgs): Promise<StepEnvelope> {
  const { step, cwd, scratchDir, input, env, onSpawn } = args;
  const cmd = isUseStep(step) ? [bundleRunPath(cwd, step.use)] : ["sh", "-c", step.sh];
  const startedAt = performance.now();

  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    const proc = Bun.spawn({
      cmd,
      cwd: scratchDir,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    onSpawn?.(proc);
    proc.stdin.write(input);
    // Awaiting `end()` waits for the buffer to drain to the OS pipe;
    // `write()` only queues into Bun's FileSink and returns synchronously.
    await proc.stdin.end();
    [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
  } catch (cause) {
    return {
      status: "failed",
      output: "",
      error:
        cause instanceof Error
          ? { message: cause.message, stack: cause.stack }
          : { message: String(cause) },
      traces: { stdout: "", stderr: "", durationMs: performance.now() - startedAt },
    };
  }

  const durationMs = performance.now() - startedAt;
  if (exitCode === 0) {
    return { status: "ok", output: stdout, traces: { stdout, stderr, durationMs } };
  }
  return {
    status: "failed",
    output: stdout,
    error: { message: `step exited with code ${exitCode}` },
    traces: { stdout, stderr, durationMs },
  };
}
