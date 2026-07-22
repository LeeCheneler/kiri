import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, rmSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRunShims } from "./shims.ts";

describe("writeRunShims", () => {
  let dir: string;
  let binDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-shim-"));
    binDir = join(dir, ".bin");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const shimPath = () => join(binDir, "kiri-output");
  const shimContent = () => readFileSync(shimPath(), "utf8");

  it("creates the bin dir and an executable kiri-output shim", () => {
    writeRunShims(binDir, { execPath: "/usr/local/bin/bun", main: "/repo/bin/kiri.ts" });

    expect(statSync(shimPath()).mode & 0o111).not.toBe(0);
    expect(shimContent().startsWith("#!/bin/sh\n")).toBe(true);
  });

  it("execs the entry script through the runtime when running from source", () => {
    writeRunShims(binDir, { execPath: "/usr/local/bin/bun", main: "/repo/bin/kiri.ts" });

    expect(shimContent()).toContain(`exec '/usr/local/bin/bun' '/repo/bin/kiri.ts' __output "$@"`);
  });

  it("execs the binary alone when the entry lives in the compiled bundle", () => {
    writeRunShims(binDir, { execPath: "/opt/homebrew/bin/kiri", main: "/$bunfs/root/kiri" });

    const content = shimContent();
    expect(content).toContain(`exec '/opt/homebrew/bin/kiri' __output "$@"`);
    expect(content).not.toContain("$bunfs");
  });

  it("single-quotes paths containing spaces and quotes", () => {
    writeRunShims(binDir, { execPath: "/pa th/bun", main: "/repo's dir/kiri.ts" });

    expect(shimContent()).toContain(`exec '/pa th/bun' '/repo'\\''s dir/kiri.ts' __output "$@"`);
  });

  it("defaults to the running process as the exec target", () => {
    writeRunShims(binDir);

    expect(shimContent()).toContain(`__output "$@"`);
    expect(statSync(shimPath()).mode & 0o111).not.toBe(0);
  });

  it("produces a shim that appends to KIRI_OUTPUTS_FILE end to end", () => {
    // Exec the real CLI from source, exactly as a dev-mode run would.
    writeRunShims(binDir, {
      execPath: process.execPath,
      main: join(import.meta.dir, "../../../bin/kiri.ts"),
    });
    const outputsFile = join(dir, "outputs.jsonl");

    const ok = Bun.spawnSync([shimPath(), "url", "hello world"], {
      env: { ...process.env, KIRI_OUTPUTS_FILE: outputsFile },
    });
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(outputsFile, "utf8").trim())).toEqual({
      name: "url",
      value: "hello world",
    });

    // Without the env var the shim must fail loudly, so `set -e` scripts
    // halt at the call site.
    const bare = Bun.spawnSync([shimPath(), "url", "hello world"], {
      env: { ...process.env, KIRI_OUTPUTS_FILE: undefined },
    });
    expect(bare.exitCode).toBe(1);
    expect(bare.stderr.toString()).toContain("KIRI_OUTPUTS_FILE is not set");
  });
});
