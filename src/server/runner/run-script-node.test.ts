import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScriptNode } from "./run-script-node.ts";

describe("runScriptNode", () => {
  let dir: string;
  let scratchDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-script-"));
    scratchDir = join(dir, "scratch");
    mkdirSync(scratchDir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeScript = (name: string, body: string): string => {
    const path = join(dir, name);
    writeFileSync(path, body);
    chmodSync(path, 0o755);
    return path;
  };

  it("returns an ok envelope for a script that exits 0", async () => {
    const scriptPath = writeScript("ok.sh", "#!/bin/sh\necho hello\n");

    const envelope = await runScriptNode({ scriptPath, scratchDir, input: "", env: {} });

    expect(envelope.status).toBe("ok");
    expect(envelope.output).toBe("hello\n");
    expect(envelope.traces.stdout).toBe("hello\n");
    expect(envelope.traces.stderr).toBe("");
    expect(envelope.error).toBeUndefined();
    expect(envelope.traces.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns a failed envelope when the script exits non-zero", async () => {
    const scriptPath = writeScript("fail.sh", "#!/bin/sh\necho boom\nexit 7\n");

    const envelope = await runScriptNode({ scriptPath, scratchDir, input: "", env: {} });

    expect(envelope.status).toBe("failed");
    expect(envelope.error?.message).toContain("7");
    expect(envelope.traces.stdout).toBe("boom\n");
  });

  it("captures stderr separately from stdout", async () => {
    const scriptPath = writeScript("err.sh", "#!/bin/sh\necho out\necho err 1>&2\n");

    const envelope = await runScriptNode({ scriptPath, scratchDir, input: "", env: {} });

    expect(envelope.traces.stdout).toBe("out\n");
    expect(envelope.traces.stderr).toBe("err\n");
  });

  it("pipes input into the script's stdin", async () => {
    const scriptPath = writeScript("cat.sh", "#!/bin/sh\ncat\n");

    const envelope = await runScriptNode({
      scriptPath,
      scratchDir,
      input: "echo me back",
      env: {},
    });

    expect(envelope.output).toBe("echo me back");
  });

  it("runs the script with cwd set to the scratch dir", async () => {
    const scriptPath = writeScript("pwd.sh", "#!/bin/sh\npwd\n");

    const envelope = await runScriptNode({ scriptPath, scratchDir, input: "", env: {} });

    // pwd resolves the path; on macOS /var/folders is a symlink to /private/var/folders.
    expect(envelope.output.trim()).toBe(realpathSync(scratchDir));
  });

  it("only exposes env vars that were explicitly passed (no parent inheritance)", async () => {
    // USER and HOME are set in the test process's env. If scoping works,
    // the child sees neither — only FOO comes through.
    expect(process.env.USER).toBeTruthy();
    expect(process.env.HOME).toBeTruthy();
    const scriptPath = writeScript("env.sh", '#!/bin/sh\necho "FOO=$FOO USER=$USER HOME=$HOME"\n');

    const envelope = await runScriptNode({
      scriptPath,
      scratchDir,
      input: "",
      env: { FOO: "bar" },
    });

    expect(envelope.status).toBe("ok");
    expect(envelope.output.trim()).toBe("FOO=bar USER= HOME=");
  });

  it("returns a failed envelope when the script does not exist", async () => {
    const envelope = await runScriptNode({
      scriptPath: join(dir, "missing.sh"),
      scratchDir,
      input: "",
      env: {},
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.error).toBeDefined();
  });
});
