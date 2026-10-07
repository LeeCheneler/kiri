import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { createInstructionContext } from "./instruction-context.ts";
import { type ShellToolsOptions, shellTools } from "./shell-tools.ts";

// Invoke the tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (
  t: ToolSet[string],
  input: unknown,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> =>
  (
    t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<Record<string, unknown>>
  )(input, { toolCallId: "call-1", messages: [], abortSignal } as ToolExecutionOptions);

const expectProcessGone = async (pid: number): Promise<void> => {
  const deadline = performance.now() + 500;
  let alive = true;
  while (alive && performance.now() < deadline) {
    try {
      process.kill(pid, 0);
      await Bun.sleep(10);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      alive = false;
    }
  }
  expect(alive).toBe(false);
};

const cleanUpProcess = (pid: number): void => {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    expect(error).toMatchObject({ code: "ESRCH" });
  }
};

describe("shellTools", () => {
  let workspace: string;
  let outside: string;
  let cwdValue: string | null;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "kiri-shell-tools-"));
    outside = mkdtempSync(join(tmpdir(), "kiri-shell-outside-"));
    cwdValue = null;
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  const tool = (dirs: string[] = [workspace], options: ShellToolsOptions = {}) =>
    shellTools(
      () => dirs,
      {
        get: () => cwdValue,
        set: (dir) => {
          cwdValue = dir;
        },
      },
      options,
    ).run_command;

  // Results report *real* absolute paths (macOS's tmpdir is symlinked), so
  // expectations build on the realpath'd roots.
  const ws = (...segments: string[]): string => join(realpathSync(workspace), ...segments);

  it("does not start a command until its explicit cwd's rules have reached the model", async () => {
    mkdirSync(ws("nested"));
    writeFileSync(ws("nested", "AGENTS.md"), "Command rule.");
    cwdValue = ws();
    const sources = { workingDirectory: cwdValue, allowedDirectories: [workspace] };
    const context = createInstructionContext(() => sources);
    context.resolve(sources);
    const guarded = tool([workspace], {
      checkInstructions: (directory) => context.requireForDirectory(directory),
    });
    const input = { command: "printf ran > result.txt", cwd: "nested" };
    await expect(run(guarded, input)).rejects.toThrow("Nothing was changed or started");
    expect(existsSync(ws("nested", "result.txt"))).toBe(false);
    context.resolve(sources);
    expect((await run(guarded, input)).exitCode).toBe(0);
    expect(readFileSync(ws("nested", "result.txt"), "utf8")).toBe("ran");
  });

  it("runs a command in the sole allowed directory when cwd is omitted with no session working directory", async () => {
    const result = await run(tool(), { command: "pwd" });
    expect(result).toEqual({
      cwd: ws(),
      exitCode: 0,
      stdout: `${ws()}\n`,
      stderr: "",
      durationMs: expect.any(Number),
    });
  });

  it("reports a non-zero exit as a result, not an error", async () => {
    const result = await run(tool(), { command: "echo before; exit 3" });
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("before\n");
  });

  it("captures stderr separately from stdout", async () => {
    const result = await run(tool(), { command: "echo out; echo oops >&2" });
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("oops\n");
  });

  it("runs through bash, not plain sh", async () => {
    const result = await run(tool(), { command: '[[ "a" == a* ]] && echo bash-here' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("bash-here\n");
  });

  it("inherits the kiri process environment", async () => {
    // HOME reaches the command only through inheritance — nothing passes it.
    const result = await run(tool(), { command: 'echo "$HOME"' });
    expect(result.stdout).toBe(`${process.env.HOME}\n`);
  });

  it("runs in a named subdirectory of an allowed directory", async () => {
    mkdirSync(join(workspace, "packages", "app"), { recursive: true });
    const result = await run(tool(), { command: "pwd", cwd: join(workspace, "packages", "app") });
    expect(result.cwd).toBe(ws("packages", "app"));
    expect(result.stdout).toBe(`${ws("packages", "app")}\n`);
  });

  it("runs in the session's working directory when cwd is omitted", async () => {
    mkdirSync(join(workspace, "sub"));
    cwdValue = ws("sub");
    const result = await run(tool([workspace, outside]), { command: "pwd" });
    expect(result.cwd).toBe(ws("sub"));
    expect(result.stdout).toBe(`${ws("sub")}\n`);
  });

  it("resolves a relative cwd against the session's working directory", async () => {
    mkdirSync(join(workspace, "packages", "app"), { recursive: true });
    cwdValue = ws("packages");
    const result = await run(tool(), { command: "pwd", cwd: "app" });
    expect(result.cwd).toBe(ws("packages", "app"));
  });

  it("rejects a relative cwd that escapes the sandbox", async () => {
    cwdValue = ws();
    expect(run(tool(), { command: "pwd", cwd: ".." })).rejects.toThrow(
      /outside the directories commands may run in/,
    );
  });

  it("requires cwd with several allowed directories and no session working directory", async () => {
    expect(run(tool([workspace, outside]), { command: "pwd" })).rejects.toThrow(
      /has no working directory/,
    );
  });

  it("deduplicates allowed directories, so a repeated entry still counts as one", async () => {
    const result = await run(tool([workspace, workspace]), { command: "pwd" });
    expect(result.cwd).toBe(ws());
  });

  it("skips a declared directory that doesn't exist", async () => {
    const result = await run(tool([join(workspace, "missing"), workspace]), { command: "pwd" });
    expect(result.cwd).toBe(ws());
  });

  it("errors when no allowed directories are configured", async () => {
    expect(run(tool([]), { command: "pwd" })).rejects.toThrow(
      /No allowed directories are configured/,
    );
  });

  it("rejects a relative cwd when the session has no working directory", async () => {
    expect(run(tool(), { command: "pwd", cwd: "packages" })).rejects.toThrow(/Relative cwd/);
  });

  it("rejects a cwd outside every allowed directory", async () => {
    expect(run(tool(), { command: "pwd", cwd: outside })).rejects.toThrow(
      /outside the directories commands may run in/,
    );
  });

  it("rejects a cwd that doesn't exist", async () => {
    expect(run(tool(), { command: "pwd", cwd: join(workspace, "nope") })).rejects.toThrow(
      /No such directory/,
    );
  });

  it("rejects a file as cwd", async () => {
    writeFileSync(join(workspace, "file.txt"), "x");
    expect(run(tool(), { command: "pwd", cwd: join(workspace, "file.txt") })).rejects.toThrow(
      /is a file/,
    );
  });

  it("judges a symlinked cwd by where it points", async () => {
    symlinkSync(outside, join(workspace, "escape"));
    expect(run(tool(), { command: "pwd", cwd: join(workspace, "escape") })).rejects.toThrow(
      /outside the directories commands may run in/,
    );
  });

  it("keeps the tail of oversized output and flags the cut, per stream", async () => {
    const result = await run(tool([workspace], { maxOutputLength: 8 }), {
      command: "printf 'abcdefghij'; printf 'short' >&2",
    });
    expect(result.stdout).toBe("cdefghij");
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderr).toBe("short");
    expect(result.stderrTruncated).toBeUndefined();
  });

  it("drops an orphan low surrogate when the cap splits a pair", async () => {
    // "xx😀yyyy" is 8 UTF-16 units; a 5-unit tail starts inside the emoji.
    const result = await run(tool([workspace], { maxOutputLength: 5 }), {
      command: "printf 'xx\\xf0\\x9f\\x98\\x80yyyy'",
    });
    expect(result.stdout).toBe("yyyy");
    expect(result.stdoutTruncated).toBe(true);
  });

  it("kills a command that outruns its timeout and flags it", async () => {
    const result = await run(tool(), { command: "sleep 30", timeout_seconds: 0.2 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs as number).toBeLessThan(5_000);
  });

  it("kills the command when the turn is cancelled", async () => {
    const controller = new AbortController();
    const pending = run(tool(), { command: "sleep 30" }, controller.signal);
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBeUndefined();
    expect(result.durationMs as number).toBeLessThan(5_000);
  });

  it.each(["timeout", "cancel"] as const)(
    "terminates descendants holding both pipes on %s without waiting for their natural exit",
    async (ending) => {
      const controller = new AbortController();
      const descendants: number[] = [];
      let consoleText = "";
      let ended = false;
      const startedAt = performance.now();
      try {
        const result = await run(
          tool([workspace], {
            liveConsole: () => ({
              append(chunk) {
                consoleText += chunk;
                descendants.splice(
                  0,
                  descendants.length,
                  ...Array.from(consoleText.matchAll(/pid=(\d+)/g), (match) => Number(match[1])),
                );
                if (ending === "cancel" && consoleText.includes("ready")) controller.abort();
              },
              end() {
                ended = true;
              },
            }),
          }),
          {
            command: `bash -c 'sleep 2 & printf captured >&2; printf "pid=%s\\nready\\n" "$!"; wait' & printf 'pid=%s\\n' "$!"; wait`,
            timeout_seconds: ending === "timeout" ? 0.1 : 30,
          },
          controller.signal,
        );
        expect(performance.now() - startedAt).toBeLessThan(1_500);
        expect(descendants).toHaveLength(2);
        expect(result.stdout).toContain("ready");
        expect(result.stderr).toBe("captured");
        expect(result.timedOut).toBe(ending === "timeout" ? true : undefined);
        expect(result.exitCode).toBeNull();
        expect(ended).toBe(true);
        for (const pid of descendants) await expectProcessGone(pid);
        descendants.length = 0;
      } finally {
        controller.abort();
        for (const pid of descendants) cleanUpProcess(pid);
      }
    },
  );

  it("kills a descendant retaining pipes even after the shell has exited naturally", async () => {
    let pid: number | undefined;
    try {
      const result = await run(
        tool([workspace], {
          liveConsole: () => ({
            append: (chunk) => {
              pid = Number(chunk);
            },
            end: () => {},
          }),
        }),
        {
          command: 'sleep 2 & printf "%s" "$!"; exit 0',
          timeout_seconds: 0.1,
        },
      );
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.durationMs as number).toBeLessThan(1_500);
      expect(pid).toBeGreaterThan(0);
      await expectProcessGone(pid as number);
      pid = undefined;
    } finally {
      if (pid !== undefined) cleanUpProcess(pid);
    }
  });

  it("does not start a command whose turn is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      run(tool(), { command: "printf started > started.txt" }, controller.signal),
    ).rejects.toThrow();
    expect(existsSync(ws("started.txt"))).toBe(false);
  });

  it.each([
    ["timeout", "pending"],
    ["timeout", "reject"],
    ["cancel", "pending"],
  ] as const)(
    "bounds draining after %s when pipes never close and reader cancellation is %s",
    async (ending, cancellation) => {
      const controller = new AbortController();
      const pipes = ["stdout", "stderr"].map((text) => {
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
          },
          cancel() {
            cancelled = true;
            return cancellation === "pending"
              ? new Promise<void>(() => {})
              : Promise.reject(new Error("Pipe cancellation failed"));
          },
        });
        return { stream, wasCancelled: () => cancelled };
      });
      const spawn = Bun.spawn.bind(Bun);
      const mock = spyOn(Bun, "spawn").mockImplementation((options) => {
        const proc = Array.isArray(options) ? spawn(options) : spawn(options);
        // Keep the actual child lifecycle; only its stuck output sources are controlled.
        return new Proxy(proc, {
          get(target, key) {
            if (key === "stdout") return pipes[0].stream;
            if (key === "stderr") return pipes[1].stream;
            return Reflect.get(target, key);
          },
        });
      });
      const { feed, factory } = fakeConsole();
      try {
        const startedAt = performance.now();
        const result = await run(
          tool([workspace], {
            liveConsole: (id) => {
              if (ending === "cancel") queueMicrotask(() => controller.abort());
              return factory(id);
            },
          }),
          { command: "exit 0", timeout_seconds: 0.05 },
          controller.signal,
        );
        expect(performance.now() - startedAt).toBeLessThan(1_500);
        expect(result).toMatchObject({ stdout: "stdout", stderr: "stderr" });
        expect(result.timedOut).toBe(ending === "timeout" ? true : undefined);
        expect(feed.ended).toBe(true);
        for (const pipe of pipes) {
          expect(pipe.wasCancelled()).toBe(true);
          expect(pipe.stream.locked).toBe(false);
        }
      } finally {
        mock.mockRestore();
      }
    },
  );

  it.each(["factory", "append"] as const)(
    "cleans up the process and both readers when the live console's %s fails",
    async (failure) => {
      const spawn = Bun.spawn.bind(Bun);
      let child:
        | { exited: Promise<number>; stdout: ReadableStream; stderr: ReadableStream }
        | undefined;
      const mock = spyOn(Bun, "spawn").mockImplementation((options) => {
        const proc = Array.isArray(options) ? spawn(options) : spawn(options);
        child = {
          exited: proc.exited,
          stdout: proc.stdout as ReadableStream,
          stderr: proc.stderr as ReadableStream,
        };
        return proc;
      });
      let ended = false;
      const error = new Error("Console unavailable");
      try {
        await expect(
          run(
            tool([workspace], {
              liveConsole: () => {
                if (failure === "factory") throw error;
                return {
                  append: () => {
                    throw error;
                  },
                  end: () => {
                    ended = true;
                  },
                };
              },
            }),
            { command: "printf ready; sleep 2; :" },
          ),
        ).rejects.toThrow(error.message);
        expect(child).toBeDefined();
        await child?.exited;
        expect(child?.stdout.locked).toBe(false);
        expect(child?.stderr.locked).toBe(false);
        expect(ended).toBe(failure === "append");
      } finally {
        mock.mockRestore();
      }
    },
  );

  it("cancelling one command leaves another command's process group alone", async () => {
    const controller = new AbortController();
    const other = run(tool(), { command: "sleep 0.1; printf unaffected" });
    const cancelled = run(
      tool([workspace], {
        liveConsole: () => ({
          append: () => controller.abort(),
          end: () => {},
        }),
      }),
      { command: "printf ready; sleep 2; :" },
      controller.signal,
    );
    const [first, second] = await Promise.all([cancelled, other]);
    expect(first.exitCode).toBeNull();
    expect(second).toMatchObject({ exitCode: 0, stdout: "unaffected" });
  });

  it("does not retain a cancellation listener after natural completion", async () => {
    const controller = new AbortController();
    const remove = spyOn(controller.signal, "removeEventListener");
    const result = await run(tool(), { command: "printf complete" }, controller.signal);
    expect(result).toMatchObject({ exitCode: 0, stdout: "complete" });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    expect(result.timedOut).toBeUndefined();
    remove.mockRestore();
  });

  // A fake live feed capturing what the tool streams through it.
  const fakeConsole = () => {
    const feed = { toolCallId: "", chunks: [] as string[], ended: false };
    const factory = (toolCallId: string) => {
      feed.toolCallId = toolCallId;
      return {
        append: (chunk: string) => {
          feed.chunks.push(chunk);
        },
        end: () => {
          feed.ended = true;
        },
      };
    };
    return { feed, factory };
  };

  it("streams output through the live console for its call, ending the feed on settle", async () => {
    const { feed, factory } = fakeConsole();
    const result = await run(tool([workspace], { liveConsole: factory }), {
      command: "echo one; echo two >&2",
    });
    expect(feed.toolCallId).toBe("call-1");
    // Both streams reached the one feed; the settled result still splits them.
    expect(feed.chunks.join("")).toContain("one\n");
    expect(feed.chunks.join("")).toContain("two\n");
    expect(feed.ended).toBe(true);
    expect(result.stdout).toBe("one\n");
    expect(result.stderr).toBe("two\n");
  });

  it("ends the live console even when the command is killed", async () => {
    const { feed, factory } = fakeConsole();
    const result = await run(tool([workspace], { liveConsole: factory }), {
      command: "echo started; exec sleep 30",
      timeout_seconds: 0.2,
    });
    expect(result.timedOut).toBe(true);
    expect(feed.chunks.join("")).toBe("started\n");
    expect(feed.ended).toBe(true);
  });
});
