import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.ts";

describe("bootstrap", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-bootstrap-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("scaffolds workflows/ and .kiri/state.db on a fresh launch", () => {
    const db = bootstrap(dir);
    expect(existsSync(join(dir, "workflows"))).toBe(true);
    expect(existsSync(join(dir, ".kiri"))).toBe(true);
    expect(existsSync(join(dir, ".kiri", "state.db"))).toBe(true);
    db.$client.close();
  });

  it("is idempotent on re-launch", () => {
    const first = bootstrap(dir);
    first.$client.close();
    const second = bootstrap(dir);
    second.$client.close();
  });
});
