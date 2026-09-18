import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describedModel } from "../../../tests/support/described-model.ts";
import type { ConfigCheck } from "../config/health.ts";
import { createApp } from "../index.ts";
import { type LlmClients, buildModelDescription } from "../llm/index.ts";
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
    it("reports degraded providers for an unconfigured workspace", async () => {
      const app = createApp({ db: env.db, registry: env.registry, config: env.config, env: {} });
      const res = await app.request("/api/config/health");
      expect(res.status).toBe(200);
      const { checks } = (await res.json()) as { checks: ConfigCheck[] };
      expect(areasByLevel(checks, "degraded")).toEqual(["providers"]);
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

    it("reports Codex expiry and sees a subsequent login without recreating the app", async () => {
      writeConfig(env.cwd, "providers:\n  codex:\n    type: openai-codex\n");
      const save = (exp: number) =>
        writeFileSync(
          join(env.cwd, "auth.json"),
          JSON.stringify({
            tokens: {
              account_id: "private-account",
              access_token: `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.private-token`,
            },
          }),
        );
      save(1);
      const app = createApp({
        db: env.db,
        registry: env.registry,
        config: env.config,
        env: { CODEX_HOME: env.cwd },
      });
      const expired = await app.request("/api/config/health");
      expect(expired.status).toBe(200);
      expect(await expired.json()).toMatchObject({
        checks: expect.arrayContaining([
          expect.objectContaining({ level: "error", title: "codex: Codex authentication expired" }),
        ]),
      });
      save(Math.floor(Date.now() / 1000) + 600);
      const renewed = await (await app.request("/api/config/health")).json();
      expect(renewed.checks.some((check: ConfigCheck) => check.level === "error")).toBe(false);
      expect(JSON.stringify(renewed)).not.toContain("private-");
    });

    it("reports only the load failure once a good config is broken by an edit", async () => {
      // Codex with no saved login: a provider whose credential check reports an error.
      writeConfig(env.cwd, "providers:\n  codex:\n    type: openai-codex\n");
      const app = createApp({
        db: env.db,
        registry: env.registry,
        config: env.config,
        env: { CODEX_HOME: env.cwd },
      });
      const before = (await (await app.request("/api/config/health")).json()) as {
        checks: ConfigCheck[];
      };
      expect(areasByLevel(before.checks, "error")).toEqual(["providers"]);

      // The last good provider is still being served, but the report describes
      // the file as it is now: broken, and nothing else.
      writeConfig(env.cwd, "providers: [not, a, map]\n");
      const after = (await (await app.request("/api/config/health")).json()) as {
        checks: ConfigCheck[];
      };
      expect(after.checks.map((check) => check.area)).toEqual(["config"]);
    });

    it("flags a configured provider whose key is missing as an error", async () => {
      writeConfig(env.cwd, "providers:\n  anthropic:\n    type: anthropic\n");
      const app = createApp({ db: env.db, registry: env.registry, config: env.config, env: {} });
      const { checks } = (await (await app.request("/api/config/health")).json()) as {
        checks: ConfigCheck[];
      };
      expect(areasByLevel(checks, "error")).toEqual(["providers"]);
    });

    it("flags a model reference to an unknown provider without llm clients wired", async () => {
      writeConfig(env.cwd, "models:\n  shortcuts:\n    text:\n      flash: nowhere:small\n");
      const app = createApp({ db: env.db, registry: env.registry, config: env.config, env: {} });
      const { checks } = (await (await app.request("/api/config/health")).json()) as {
        checks: ConfigCheck[];
      };
      expect(areasByLevel(checks, "error")).toEqual(["models"]);
    });

    it("appends listing-level model checks when llm clients are wired", async () => {
      writeConfig(
        env.cwd,
        [
          "providers:",
          "  local:",
          "    type: openai-compatible",
          "    base_url: http://localhost:9/v1",
          "models:",
          "  shortcuts:",
          "    text:",
          "      real: local:listed",
          "      typo: local:missing",
        ].join("\n"),
      );
      const llmClients: LlmClients = {
        resolveModel: () => {
          throw new Error("unused in this fake");
        },
        resolveImageModel: () => {
          throw new Error("unused in this fake");
        },
        resolveTranscriptionModel: () => {
          throw new Error("unused in this fake");
        },
        generateText: async () => ({ text: "", usage: {} }),
        listModels: async () => ({
          models: [
            buildModelDescription(
              { name: "local", type: "openai-compatible", baseUrl: "http://x" },
              "listed",
              { id: "local:listed", provider: "local", output: "text", reasoning: false },
            ),
          ],
          failures: [],
        }),
        describeModel: async (id) => describedModel(id),
      };
      const app = createApp({
        db: env.db,
        registry: env.registry,
        config: env.config,
        env: {},
        llmClients,
      });
      const { checks } = (await (await app.request("/api/config/health")).json()) as {
        checks: ConfigCheck[];
      };
      const degraded = checks.filter((c) => c.area === "models" && c.level === "degraded");
      expect(degraded).toHaveLength(1);
      expect(degraded[0].title).toBe("shortcuts.text.typo: model not listed");
    });
  });
});
