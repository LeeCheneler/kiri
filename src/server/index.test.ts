import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.ts";
import type { KiriDb } from "./db/index.ts";
import { createApp } from "./index.ts";
import { createRegistry } from "./workflows/index.ts";

describe("createApp", () => {
  let cwd: string;
  let db: KiriDb;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-app-"));
    db = bootstrap(cwd);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns ok on GET /api/health", async () => {
    const app = createApp({ db, registry: createRegistry(), cwd });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
