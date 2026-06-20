import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigCheck } from "../config/health.ts";
import { createApp } from "../index.ts";
import { type TestEnv, createTestEnv } from "./test-helpers.ts";

const writeConfig = (cwd: string, yaml: string): void =>
  writeFileSync(join(cwd, "kiri.yaml"), yaml);

const areasByLevel = (checks: ConfigCheck[], level: ConfigCheck["level"]): string[] =>
  checks.filter((c) => c.level === level).map((c) => c.area);

describe("config routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  describe("GET /api/config/health", () => {
    it("reports degraded providers and web search for an unconfigured workspace", async () => {
      const app = createApp({ db: env.db, registry: env.registry, config: env.config, env: {} });
      const res = await app.request("/api/config/health");
      expect(res.status).toBe(200);
      const { checks } = (await res.json()) as { checks: ConfigCheck[] };
      expect(areasByLevel(checks, "degraded")).toEqual(["providers", "web-search"]);
    });

    it("reads providers from disk and keys from the supplied env", async () => {
      writeConfig(env.cwd, "providers:\n  anthropic:\n    type: anthropic\n");
      const app = createApp({
        db: env.db,
        registry: env.registry,
        config: env.config,
        env: { ANTHROPIC_API_KEY: "secret" },
      });
      const { checks } = (await (await app.request("/api/config/health")).json()) as {
        checks: ConfigCheck[];
      };
      const providers = checks.filter((c) => c.area === "providers");
      expect(providers).toHaveLength(1);
      expect(providers[0].level).toBe("ok");
      expect(providers[0].detail).toBe("anthropic");
    });

    it("flags a configured provider whose key is missing as an error", async () => {
      writeConfig(env.cwd, "providers:\n  anthropic:\n    type: anthropic\n");
      const app = createApp({ db: env.db, registry: env.registry, config: env.config, env: {} });
      const { checks } = (await (await app.request("/api/config/health")).json()) as {
        checks: ConfigCheck[];
      };
      expect(areasByLevel(checks, "error")).toEqual(["providers"]);
    });
  });
});
