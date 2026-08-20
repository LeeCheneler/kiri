import type { ConfigStore } from "../config/store.ts";
import type { LlmClients, LlmUsage } from "../llm/index.ts";
import { type WorkflowStep, isLlmStep, isUseStep } from "../workflows/index.ts";
import type { ChildHandle } from "./cancel-registry.ts";
import { runLlmStep } from "./run-llm-step.ts";

/**
 * Standard envelope for a step, matching the shape every step variant
 * returns. `output` is the captured stdout; later phases reach it through
 * `{ step: <id> }` env refs. `traces.console` is stdout and stderr merged
 * in arrival order — the step's output as a terminal would have shown it.
 * `traces.usage` carries token counts and is only present on `llm:` steps.
 */
export interface StepEnvelope {
  status: "ok" | "failed";
  output: string;
  error?: { message: string; stack?: string };
  traces: {
    stdout: string;
    stderr: string;
    console: string;
    durationMs: number;
    usage?: LlmUsage;
  };
}

export interface RunStepArgs {
  /** The validated workflow step — a `use:` bundle reference, an inline `sh:` snippet, or an `llm:` completion. */
  step: WorkflowStep;
  /** Workspace config. Resolves `use:` bundles via `config.bundleRunPath()` and `llm:` prompt files. */
  config: ConfigStore;
  /** Working directory for the spawned process — typically a per-run scratch dir. */
  scratchDir: string;
  /**
   * Scoped env vars exposed to the step. No parent-process inheritance —
   * pass exactly what the step should see. Empty object means an empty env.
   * `llm:` steps spawn nothing, so for them the map serves as the prompt's
   * template vars instead.
   */
  env: Record<string, string>;
  /** Completion client for `llm:` steps. Absent ⇒ they fail cleanly. */
  llmClients?: LlmClients;
  /**
   * Invoked synchronously before the step starts waiting, with the handle
   * that stops it — the live subprocess, or an abort adapter for `llm:`
   * steps. The runner publishes it to the cancel registry so an in-flight
   * cancel can stop the work.
   */
  onSpawn?: (handle: ChildHandle) => void;
  /**
   * Invoked with each decoded chunk of the child's output as it arrives,
   * stdout and stderr interleaved by arrival order — the same merge the
   * envelope accumulates as `traces.console`, surfaced incrementally.
   * Never called for `llm:` steps (they spawn nothing).
   */
  onOutput?: (chunk: string) => void;
}

/**
 * Ceiling for the combined byte size of a spawned step's env entries.
 * macOS caps argv + envp handed to exec at ~1 MB (ARG_MAX); past that the
 * spawn dies with an opaque E2BIG. A `{ step: <id> }` env ref carrying a
 * huge upstream stdout is the realistic way to get there, so the limit
 * sits under the OS cap with headroom for argv and the kiri overlay, and
 * the error names the largest entries so it points back at the ref.
 */
const ENV_BYTE_LIMIT = 900 * 1024;

/**
 * Drain one pipe to a string, surfacing each chunk as it arrives. A per-pipe
 * streaming decoder keeps multibyte characters split across chunk boundaries
 * intact.
 */
const readPipe = async (
  pipe: ReadableStream<Uint8Array<ArrayBuffer>>,
  onChunk?: (chunk: string) => void,
): Promise<string> => {
  const decoder = new TextDecoder();
  const reader = pipe.getReader();
  let text = "";
  const push = (chunk: string): void => {
    if (!chunk) return;
    text += chunk;
    onChunk?.(chunk);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    push(decoder.decode(value, { stream: true }));
  }
  push(decoder.decode());
  return text;
};

const envByteSize = (env: Record<string, string>): number =>
  Object.entries(env).reduce(
    // Each envp entry is "KEY=value\0".
    (total, [key, value]) => total + Buffer.byteLength(key) + Buffer.byteLength(value) + 2,
    0,
  );

/**
 * Execute a workflow step and assemble the standard envelope.
 *
 * `use:` steps spawn the bundle's `run.sh` directly (`[runPath]`); `sh:`
 * steps spawn `["sh", "-c", inline]`. Both use the explicit argv form —
 * no shell interpolation of any input. Caller controls `cwd`
 * (scratchDir) and the env scope. Spawn-time failure (missing script,
 * not executable) and a non-zero exit both yield `status: "failed"`
 * with the cause in `error`. `llm:` steps spawn nothing — they render
 * their prompt and run a completion instead (see `runLlmStep`), so the
 * env size guard doesn't apply to them.
 */
export async function runStep(args: RunStepArgs): Promise<StepEnvelope> {
  const { step, config, scratchDir, env, llmClients, onSpawn, onOutput } = args;
  if (isLlmStep(step)) {
    return runLlmStep({ step, config, env, llmClients, onSpawn });
  }
  const cmd = isUseStep(step) ? [config.bundleRunPath(step.use)] : ["sh", "-c", step.sh];
  const startedAt = performance.now();

  const envBytes = envByteSize(env);
  if (envBytes > ENV_BYTE_LIMIT) {
    const largest = Object.entries(env)
      .map(([key, value]) => [key, Buffer.byteLength(value)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, bytes]) => `${key} (${Math.round(bytes / 1024)} KB)`)
      .join(", ");
    return {
      status: "failed",
      output: "",
      error: {
        message:
          `step env is ${Math.round(envBytes / 1024)} KB, over the ${Math.round(ENV_BYTE_LIMIT / 1024)} KB exec limit — ` +
          `largest entries: ${largest}. Trim the referenced output or move the data to a file.`,
      },
      traces: { stdout: "", stderr: "", console: "", durationMs: performance.now() - startedAt },
    };
  }

  let stdout: string;
  let stderr: string;
  let consoleText = "";
  let exitCode: number;
  try {
    // stdin is /dev/null: data reaches a step only through its declared
    // env refs, so a script that reads stdin sees immediate EOF.
    const proc = Bun.spawn({
      cmd,
      cwd: scratchDir,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    onSpawn?.(proc);
    const emit = (chunk: string): void => {
      consoleText += chunk;
      onOutput?.(chunk);
    };
    [stdout, stderr, exitCode] = await Promise.all([
      readPipe(proc.stdout, emit),
      readPipe(proc.stderr, emit),
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
      traces: { stdout: "", stderr: "", console: "", durationMs: performance.now() - startedAt },
    };
  }

  const durationMs = performance.now() - startedAt;
  if (exitCode === 0) {
    return {
      status: "ok",
      output: stdout,
      traces: { stdout, stderr, console: consoleText, durationMs },
    };
  }
  return {
    status: "failed",
    output: stdout,
    error: { message: `step exited with code ${exitCode}` },
    traces: { stdout, stderr, console: consoleText, durationMs },
  };
}
