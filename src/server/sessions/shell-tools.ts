import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { SessionCwd } from "./filesystem-tools.ts";
import type { LiveConsoleEmitter } from "./live-console.ts";

// Cap on each returned output stream (stdout and stderr independently). The
// tail is kept — a failing build or test run prints its cause last — and the
// result flags the cut so the model treats it as incomplete.
const MAX_OUTPUT_LENGTH = 16 * 1024;

// How long a command may run when the call names no timeout_seconds. The
// schema caps an explicit value at 600 — a session command is foreground work
// inside a turn, not a background job.
const DEFAULT_TIMEOUT_SECONDS = 120;

// After a kill, inherited pipes must not keep the turn waiting indefinitely.
const CLEANUP_ALLOWANCE_MS = 1000;

const killProcessGroup = (pid: number): void => {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    // The command may have exited between observing cancellation and signalling it.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
};

/** Tunable bounds, defaulting to the module constants. Tests pass tiny values. */
export interface ShellToolsOptions {
  /** Checks the confined command directory's instructions before starting the process. */
  checkInstructions?: (directory: string) => void;
  maxOutputLength?: number;
  /**
   * Builds the live feed a call streams its merged output through while it
   * runs — stdout and stderr interleaved by arrival — ended when the command
   * settles. Omitted, output is captured only for the result.
   */
  liveConsole?: (toolCallId: string) => LiveConsoleEmitter;
}

// Drain one pipe to a string, surfacing each decoded chunk as it arrives. A
// per-pipe streaming decoder keeps multibyte characters split across chunk
// boundaries intact.
const readPipe = async (
  pipe: ReadableStream<Uint8Array<ArrayBuffer>>,
  onChunk: (chunk: string) => void,
  stopSignal: AbortSignal,
): Promise<string> => {
  const decoder = new TextDecoder();
  const reader = pipe.getReader();
  let text = "";
  let reachedEof = false;
  // Reader cancellation closes pending reads immediately, independently of the
  // underlying source's cancellation promise. Never wait for that promise.
  const cancelReader = (): void => {
    void reader.cancel().catch(() => {});
  };
  stopSignal.addEventListener("abort", cancelReader, { once: true });
  const push = (chunk: string): void => {
    if (!chunk) return;
    text += chunk;
    onChunk(chunk);
  };
  try {
    while (!stopSignal.aborted) {
      const next = await reader.read();
      if (stopSignal.aborted) break;
      if (next.done) {
        reachedEof = true;
        break;
      }
      push(decoder.decode(next.value, { stream: true }));
    }
    push(decoder.decode());
    return text;
  } finally {
    stopSignal.removeEventListener("abort", cancelReader);
    if (!reachedEof) cancelReader();
    reader.releaseLock();
  }
};

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
 * executed with `bash -c` on the host, anchored inside the workspace's
 * filesystem sandbox. A command runs in the session's working directory
 * unless the call's `cwd` overrides it (absolute, or relative to the session's
 * working directory). Only the command's *working directory* is confined
 * (resolved to its real form and required to sit inside one of
 * `getAllowedDirectories()`, which a session turn fixes when it starts): what the command itself
 * touches is not, which is why the tool's standing permission defaults to
 * asking per call. The command runs non-interactively (stdin closed) with the
 * kiri process's environment. Timeout or turn cancellation kills its isolated
 * POSIX process group and bounds output draining and exit waiting to one more
 * second, retaining captured output. Descendants that create another process
 * group can escape termination. Already-aborted calls throw without spawning.
 * A non-zero exit is a *result* — exit code, stdout, and stderr, each stream
 * tail-capped — not a tool error. A call that can't start (bad cwd, no configured
 * directories) throws, with a message naming what recovers. While a command
 * runs, its merged output streams through the `liveConsole` feed when one is
 * wired; the settled result is unaffected either way.
 */
export function shellTools(
  getAllowedDirectories: () => readonly string[],
  cwd: SessionCwd,
  options: ShellToolsOptions = {},
): ToolSet {
  const { maxOutputLength = MAX_OUTPUT_LENGTH, liveConsole } = options;

  // The sandbox as real paths, deduplicated; an entry that doesn't exist on
  // disk can't be run in and is skipped.
  const allowedDirs = (): string[] => {
    const dirs = new Set<string>();
    for (const dir of getAllowedDirectories()) {
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

  // Resolve where the command runs to its real absolute form and reject — as
  // a recoverable tool error — anything missing, not a directory, or outside
  // every allowed root. An omitted cwd is the session's working directory
  // (falling back to the sole allowed directory when the session has none); a
  // relative cwd resolves against the session's working directory, like the
  // filesystem tools' paths.
  const confineCwd = (userCwd: string | undefined): string => {
    const dirs = allowedDirs();
    if (dirs.length === 0) {
      throw new Error(
        "No allowed directories are configured — the user must declare filesystem.allowed_directories in kiri.yaml.",
      );
    }
    const sessionCwd = cwd.get();
    let target: string;
    if (userCwd === undefined) {
      if (sessionCwd !== null) {
        target = sessionCwd;
      } else if (dirs.length === 1) {
        target = dirs[0];
      } else {
        throw new Error(
          `The session has no working directory — set one with set_working_directory, or pass cwd as one of ${describeDirs(dirs)} (or a subdirectory).`,
        );
      }
    } else if (isAbsolute(userCwd)) {
      target = userCwd;
    } else if (sessionCwd !== null) {
      target = join(sessionCwd, userCwd);
    } else {
      throw new Error(
        `Relative cwd "${userCwd}" — the session has no working directory; pass an absolute path (commands may run in ${describeDirs(dirs)}).`,
      );
    }
    let real: string;
    try {
      real = realpathSync(target);
    } catch {
      throw new Error(`No such directory "${target}" — commands may run in ${describeDirs(dirs)}.`);
    }
    if (!statSync(real).isDirectory()) {
      throw new Error(`"${target}" is a file — pass the directory to run the command in.`);
    }
    if (!dirs.some((dir) => real === dir || real.startsWith(dir + sep))) {
      throw new Error(
        `"${target}" is outside the directories commands may run in (${describeDirs(dirs)}) — stay inside them.`,
      );
    }
    return real;
  };

  return {
    run_command: tool({
      description:
        "Run a shell command on the user's machine, executed with bash -c in the session's working directory unless cwd names another allowed directory. The result carries the exit code, stdout, and stderr — a non-zero exit is a result to read and act on, not an error. Commands run non-interactively (stdin reads end-of-file, so interactive prompts fail rather than wait) and support foreground-only work that finishes within timeout_seconds. Use one-shot/non-watch modes; never start servers, watchers, daemons, or detached/background jobs, or leave processes running after the call. There is no background process management. Each output stream is trimmed to its tail past a cap, flagged with stdoutTruncated/stderrTruncated. Prefer the filesystem tools to read, search, or edit files; reach for this to build, test, use git, and run the user's own scripts and tooling.",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .describe("The foreground shell command to run to completion, executed with bash -c."),
        cwd: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Directory to run in — absolute, or relative to the session's working directory; must be inside the allowed directories. Omitted, the command runs in the session's working directory.",
          ),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(600)
          .optional()
          .describe(
            "Seconds the command may run before its process group is killed, followed by at most one second of output-draining and exit-wait cleanup. Defaults to 120; raise it only for genuinely long work like a full build.",
          ),
      }),
      execute: async ({ command, cwd, timeout_seconds }, { toolCallId, abortSignal }) => {
        const real = confineCwd(cwd);
        options.checkInstructions?.(real);
        abortSignal?.throwIfAborted();
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
          // POSIX setsid gives this awaited command its own group, not Kiri's.
          detached: true,
        });
        const stopReading = new AbortController();
        const cleanupExpired = Promise.withResolvers<void>();
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        let finished = false;
        // SIGKILL cannot be trapped; group signalling reaches ordinary descendants
        // even when the shell has already exited but they still hold its pipes.
        const stop = (): void => {
          if (cleanupTimer !== undefined || finished) return;
          killProcessGroup(proc.pid);
          cleanupTimer = setTimeout(() => {
            stopReading.abort();
            cleanupExpired.resolve();
          }, CLEANUP_ALLOWANCE_MS);
        };
        const timer = setTimeout(() => {
          if (cleanupTimer !== undefined) return;
          timedOut = true;
          stop();
        }, timeoutMs);
        const onAbort = (): void => stop();
        abortSignal?.addEventListener("abort", onAbort, { once: true });
        let live: LiveConsoleEmitter | undefined;
        const emit = (chunk: string): void => live?.append(chunk);
        const pipeReads = [
          readPipe(proc.stdout, emit, stopReading.signal),
          readPipe(proc.stderr, emit, stopReading.signal),
        ];
        let stdout: string;
        let stderr: string;
        try {
          live = liveConsole?.(toolCallId);
          if (abortSignal?.aborted) stop();
          [stdout, stderr] = await Promise.all(pipeReads);
          await Promise.race([proc.exited, cleanupExpired.promise]);
          finished = true;
        } finally {
          clearTimeout(timer);
          clearTimeout(cleanupTimer);
          abortSignal?.removeEventListener("abort", onAbort);
          try {
            if (!finished) killProcessGroup(proc.pid);
          } finally {
            stopReading.abort();
            // Finish reader cleanup even if the console or one pipe failed.
            await Promise.allSettled(pipeReads);
            live?.end();
          }
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
