import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "./run.ts";

describe("runGit", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-run-git-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("captures stdout of a command that succeeds", async () => {
    const result = await runGit(dir, "init", "-q", "-b", "main");
    expect(result.ok).toBe(true);

    const branch = await runGit(dir, "symbolic-ref", "--short", "HEAD");
    expect(branch.ok).toBe(true);
    expect(branch.stdout.trim()).toBe("main");
  });

  it("reports a failed command with its trimmed stderr", async () => {
    const result = await runGit(dir, "rev-parse", "HEAD");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("not a git repository");
    expect(result.stderr).toBe(result.stderr.trim());
  });

  it("reports a cwd that cannot be spawned in rather than throwing", async () => {
    const result = await runGit(join(dir, "missing"), "status");
    expect(result).toEqual({
      ok: false,
      stdout: "",
      stderr: expect.stringContaining("no such file or directory"),
    });
  });
});
