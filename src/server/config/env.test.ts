import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkspaceEnv } from "./env.ts";
import { createConfigStore } from "./store.ts";

describe("loadWorkspaceEnv", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is a no-op when no .env file exists", () => {
    const target: Record<string, string | undefined> = {};
    expect(loadWorkspaceEnv(createConfigStore(dir), target)).toEqual([]);
    expect(target).toEqual({});
  });

  it("defaults to process.env, leaving it untouched when no .env exists", () => {
    expect(loadWorkspaceEnv(createConfigStore(dir))).toEqual([]);
  });

  it("applies variables from the workspace .env, ignoring comments and quotes", () => {
    writeFileSync(join(dir, ".env"), '# a comment\nFOO=bar\nGREETING="hello world"\n');
    const target: Record<string, string | undefined> = {};
    const applied = loadWorkspaceEnv(createConfigStore(dir), target);
    expect(applied.sort()).toEqual(["FOO", "GREETING"]);
    expect(target.FOO).toBe("bar");
    expect(target.GREETING).toBe("hello world");
  });

  it("does not override a variable already set in the target", () => {
    writeFileSync(join(dir, ".env"), "TOKEN=from-file\n");
    const target: Record<string, string | undefined> = { TOKEN: "from-ambient" };
    const applied = loadWorkspaceEnv(createConfigStore(dir), target);
    expect(applied).toEqual([]);
    expect(target.TOKEN).toBe("from-ambient");
  });
});
