/**
 * Standard envelope for a script node, matching the shape every node kind
 * returns. `output` is the captured stdout; for a multi-node pipeline the
 * runner pipes this into the next node's stdin.
 */
export interface ScriptNodeEnvelope {
  status: "ok" | "failed";
  output: string;
  error?: { message: string; stack?: string };
  traces: { stdout: string; stderr: string; durationMs: number };
}

export interface RunScriptNodeArgs {
  /** Absolute path to the script to execute. Must have execute permission and a shebang. */
  scriptPath: string;
  /** Working directory for the spawned process — typically a per-run scratch dir. */
  scratchDir: string;
  /** Bytes piped to the script's stdin. Pass `""` for the first node in a pipeline. */
  input: string;
  /**
   * Scoped env vars exposed to the script. No parent-process inheritance —
   * pass exactly what the script should see. Empty object means an empty env.
   */
  env: Record<string, string>;
}

/**
 * Spawn a script as a single workflow node and assemble the standard envelope.
 *
 * Spawned via an explicit `argv` array (`[scriptPath]`) — no shell, no
 * interpolation of any kind. Caller controls `cwd` and the env scope.
 * Spawn-time failure (missing script, not executable) and a non-zero exit
 * both yield `status: "failed"` with the cause in `error`.
 */
export async function runScriptNode(args: RunScriptNodeArgs): Promise<ScriptNodeEnvelope> {
  const { scriptPath, scratchDir, input, env } = args;
  const startedAt = performance.now();

  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    const proc = Bun.spawn({
      cmd: [scriptPath],
      cwd: scratchDir,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
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
    error: { message: `script exited with code ${exitCode}` },
    traces: { stdout, stderr, durationMs },
  };
}
