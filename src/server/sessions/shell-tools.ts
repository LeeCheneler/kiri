import { realpathSync, statSync } from "node:fs";
import { isAbsolute, sep } from "node:path";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

// Cap on each returned output stream (stdout and stderr independently). The
// tail is kept — a failing build or test run prints its cause last — and the
// result flags the cut so the model treats it as incomplete.
const MAX_OUTPUT_LENGTH = 16 * 1024;

// How long a command may run when the call names no timeout_seconds. The
// schema caps an explicit value at 600 — a session command is foreground work
// inside a turn, not a background job.
const DEFAULT_TIMEOUT_SECONDS = 120;

/** Tunable bounds, defaulting to the module constants. Tests pass tiny values. */
export interface ShellToolsOptions {
  maxOutputLength?: number;
}

// Keep a stream's tail within `max` characters. A tail starting with a low
// surrogate (0xdc00–0xdfff) carries an orphan half of a split pair; drop it
// rather than returning invalid text.
const tailCap = (value: string, max: number): { text: string; truncated: boolean } => {
  if (value.length <= max) return { text: value, truncated: false };
  let tail = value.slice(-max);
  const first = tail.charCodeAt(0);
  if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1);
  return { text: tail, truncated: true };
};

/**
 * First-party tool that lets a session run a shell command — `run_command` —
 * executed with `bash -c` on the host, anchored to the workspace's declared
 * working directories. Only the command's *working directory* is confined
 * (resolved to its real form and required to sit inside one of
 * `getWorkingDirectories()`, read live per call): what the command itself
 * touches is not, which is why the tool's standing permission defaults to
 * asking per call. The command runs non-interactively (stdin closed) with the
 * kiri process's environment, must finish within its timeout (killed
 * otherwise), and dies with the turn when a cancel aborts it. A non-zero exit
 * is a *result* — exit code, stdout, and stderr, each stream tail-capped —
 * not a tool error; only a call that can't start (bad cwd, no configured
 * directories) throws, with a message naming what recovers.
 */
export function shellTools(
  getWorkingDirectories: () => readonly string[],
  options: ShellToolsOptions = {},
): ToolSet {
  const { maxOutputLength = MAX_OUTPUT_LENGTH } = options;

  // The declared working directories as real paths, deduplicated; an entry
  // that doesn't exist on disk can't be run in and is skipped.
  const workingDirs = (): string[] => {
    const dirs = new Set<string>();
    for (const dir of getWorkingDirectories()) {
      try {
        dirs.add(realpathSync(dir));
      } catch {
        // Skipped: a declared directory that doesn't exist.
      }
    }
    return [...dirs];
  };

  // Only ever called with at least one directory — confineCwd rejects an
  // empty set before any message needs to name the roots.
  const describeDirs = (dirs: string[]): string => dirs.map((dir) => `"${dir}"`).join(", ");

  // Resolve the call's working directory to its real absolute form and reject
  // — as a recoverable tool error — anything relative, missing, not a
  // directory, or outside every declared root. An omitted cwd falls back to
  // the sole declared directory; with several declared it must be named, so a
  // command never silently runs in the wrong project.
  const confineCwd = (userCwd: string | undefined): string => {
    const dirs = workingDirs();
    if (dirs.length === 0) {
      throw new Error(
        "No shell working directories are configured — the user must declare shell.working_directories in kiri.yaml.",
      );
    }
    if (userCwd === undefined) {
      if (dirs.length === 1) return dirs[0];
      throw new Error(
        `Several working directories are configured — pass cwd as one of ${describeDirs(dirs)} (or a subdirectory).`,
      );
    }
    if (!isAbsolute(userCwd)) {
      throw new Error(
        `Relative cwd "${userCwd}" — pass an absolute path; commands may run in ${describeDirs(dirs)}.`,
      );
    }
    let real: string;
    try {
      real = realpathSync(userCwd);
    } catch {
      throw new Error(
        `No such directory "${userCwd}" — commands may run in ${describeDirs(dirs)}.`,
      );
    }
    if (!statSync(real).isDirectory()) {
      throw new Error(`"${userCwd}" is a file — pass the directory to run the command in.`);
    }
    if (!dirs.some((dir) => real === dir || real.startsWith(dir + sep))) {
      throw new Error(
        `"${userCwd}" is outside the directories commands may run in (${describeDirs(dirs)}) — stay inside them.`,
      );
    }
    return real;
  };

  return {
    run_command: tool({
      description:
        "Run a shell command on the user's machine, executed with bash -c in one of the allowed working directories. The result carries the exit code, stdout, and stderr — a non-zero exit is a result to read and act on, not an error. Commands run non-interactively (stdin reads end-of-file, so interactive prompts fail rather than wait) and must finish within timeout_seconds — never start servers, watchers, or anything meant to keep running. Each output stream is trimmed to its tail past a cap, flagged with stdoutTruncated/stderrTruncated. Prefer the filesystem tools to read, search, or edit files; reach for this to build, test, use git, and run the user's own scripts and tooling.",
      inputSchema: z.object({
        command: z.string().min(1).describe("The shell command to run, executed with bash -c."),
        cwd: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Absolute path to run in — one of the allowed working directories or a subdirectory. May be omitted only when exactly one is configured.",
          ),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(600)
          .optional()
          .describe(
            "Seconds the command may run before it is killed. Defaults to 120; raise it only for genuinely long work like a full build.",
          ),
      }),
      execute: async ({ command, cwd, timeout_seconds }, { abortSignal }) => {
        const real = confineCwd(cwd);
        const timeoutMs = (timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
        const startedAt = performance.now();
        // env is inherited from the kiri process — PATH, HOME, and the user's
        // tooling setup are the point. Deliberately unlike workflow steps'
        // scoped env: this is interactive, per-call-approved work as the user.
        const proc = Bun.spawn({
          cmd: ["bash", "-c", command],
          cwd: real,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        // SIGKILL, not SIGTERM: a timed-out or cancelled command is already
        // being abandoned, and a kill that can be trapped can hang the turn.
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, timeoutMs);
        const onAbort = () => proc.kill("SIGKILL");
        abortSignal?.addEventListener("abort", onAbort, { once: true });
        let stdout: string;
        let stderr: string;
        try {
          [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
          ]);
          await proc.exited;
        } finally {
          clearTimeout(timer);
          abortSignal?.removeEventListener("abort", onAbort);
        }
        const durationMs = Math.round(performance.now() - startedAt);
        const out = tailCap(stdout, maxOutputLength);
        const err = tailCap(stderr, maxOutputLength);
        // A signal death reports exitCode null; timedOut says which kill it was.
        return {
          cwd: real,
          exitCode: proc.exitCode,
          stdout: out.text,
          stderr: err.text,
          durationMs,
          ...(timedOut ? { timedOut: true as const } : {}),
          ...(out.truncated ? { stdoutTruncated: true as const } : {}),
          ...(err.truncated ? { stderrTruncated: true as const } : {}),
        };
      },
    }),
  };
}
