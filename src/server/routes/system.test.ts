import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createApp } from "../index.ts";
import { type TestEnv, createTestEnv } from "./test-helpers.ts";

describe("system routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  describe("GET /api/health", () => {
    it("returns ok", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });
  });

  describe("GET /api/version", () => {
    it("returns the version passed to createApp", async () => {
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        version: "v9.9.9",
      });
      const res = await app.request("/api/version");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ version: "v9.9.9" });
    });

    it('defaults to "dev" when version is not provided', async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/version");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ version: "dev" });
    });
  });
});
