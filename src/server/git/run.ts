/** Outcome of one git invocation: whether it exited 0, plus its captured output. */
export interface GitResult {
  ok: boolean;
  stdout: string;
  /** Captured stderr, trimmed — the reason a failed command gives. */
  stderr: string;
}

/**
 * Run `git` with `args` in `cwd` and capture its output. Never throws: a failed
 * command and a `cwd` that cannot be spawned in (missing, or not a directory)
 * both come back as `ok: false` with the reason on `stderr`, leaving every call
 * site to decide whether that is fatal.
 */
export async function runGit(cwd: string, ...args: string[]): Promise<GitResult> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn({
      cmd: ["git", ...args],
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, stdout, stderr: stderr.trim() };
}
