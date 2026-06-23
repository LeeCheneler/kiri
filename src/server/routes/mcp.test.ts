import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type EventBus, createEventBus } from "../events/index.ts";
import { createApp } from "../index.ts";
import { createMcpCredentialStore } from "../mcp/oauth-store.ts";
import type { McpRegistry, McpServerStatus } from "../mcp/registry.ts";
import type { McpAuth } from "./mcp.ts";
import { type TestEnv, createTestEnv } from "./test-helpers.ts";

const REDIRECT_BASE = "http://127.0.0.1:4242";
const SERVER_URL = "https://mcp.linear.app/mcp";

const writeOauthConfig = (cwd: string): void =>
  writeFileSync(
    join(cwd, "kiri.yaml"),
    `mcp:\n  linear:\n    type: http\n    url: ${SERVER_URL}\n    auth: oauth\n`,
  );

const fakeRegistry = (statuses: McpServerStatus[] = [], onReplace?: () => void): McpRegistry => ({
  tools: () => ({}),
  status: () => statuses,
  replace: async () => onReplace?.(),
  close: async () => {},
});

describe("mcp routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  const buildApp = (
    auth: McpAuth,
    opts: { registry?: McpRegistry; bus?: EventBus } = {},
  ): ReturnType<typeof createApp> =>
    createApp({
      db: env.db,
      registry: env.registry,
      config: env.config,
      env: {},
      bus: opts.bus,
      mcpRegistry: opts.registry ?? fakeRegistry(),
      mcpCredentialStore: createMcpCredentialStore(env.config.mcpCredentialsFile(), REDIRECT_BASE),
      mcpAuth: auth,
    });

  // Persist a CSRF state for a server (as the start flow would) and return it.
  const seedState = (server: string): string =>
    createMcpCredentialStore(env.config.mcpCredentialsFile(), REDIRECT_BASE)
      .providerFor(server)
      .state();

  describe("GET /api/mcp/servers", () => {
    it("returns the registry's per-server status", async () => {
      const statuses: McpServerStatus[] = [
        { name: "linear", type: "http", state: "needs-sign-in" },
      ];
      const app = buildApp(async () => "REDIRECT", { registry: fakeRegistry(statuses) });
      const res = await app.request("/api/mcp/servers");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ servers: statuses });
    });
  });

  describe("GET /api/mcp/:server/auth/start", () => {
    it("redirects the browser to the provider authorization URL", async () => {
      writeOauthConfig(env.cwd);
      const auth: McpAuth = async (provider) => {
        provider.redirectToAuthorization(new URL("https://auth.linear.app/authorize?x=1"));
        return "REDIRECT";
      };
      const res = await buildApp(auth).request("/api/mcp/linear/auth/start");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://auth.linear.app/authorize?x=1");
    });

    it("reconnects and reports success when already authorized", async () => {
      writeOauthConfig(env.cwd);
      let replaced = false;
      const app = buildApp(async () => "AUTHORIZED", {
        registry: fakeRegistry([], () => {
          replaced = true;
        }),
      });
      const res = await app.request("/api/mcp/linear/auth/start");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("Connected to linear");
      expect(replaced).toBe(true);
    });

    it("404s for a server that is not an OAuth MCP server", async () => {
      const res = await buildApp(async () => "REDIRECT").request("/api/mcp/ghost/auth/start");
      expect(res.status).toBe(404);
      expect(await res.text()).toContain("no OAuth MCP server");
    });

    it("502s when the provider yields no authorization URL", async () => {
      writeOauthConfig(env.cwd);
      const res = await buildApp(async () => "REDIRECT").request("/api/mcp/linear/auth/start");
      expect(res.status).toBe(502);
      expect(await res.text()).toContain("no authorization URL");
    });

    it("502s with the message when auth throws", async () => {
      writeOauthConfig(env.cwd);
      const auth: McpAuth = async () => {
        throw new Error("discovery failed");
      };
      const res = await buildApp(auth).request("/api/mcp/linear/auth/start");
      expect(res.status).toBe(502);
      expect(await res.text()).toContain("discovery failed");
    });
  });

  describe("GET /api/mcp/:server/auth/callback", () => {
    it("exchanges the code, reconnects, and signals the UI", async () => {
      writeOauthConfig(env.cwd);
      const state = seedState("linear");
      const bus = createEventBus();
      const events: string[] = [];
      bus.subscribe((e) => events.push(e.type));
      let captured: unknown;
      let replaced = false;
      const auth: McpAuth = async (provider, options) => {
        captured = options;
        provider.saveTokens({ access_token: "at", token_type: "Bearer" });
        return "AUTHORIZED";
      };
      const app = buildApp(auth, {
        bus,
        registry: fakeRegistry([], () => {
          replaced = true;
        }),
      });
      const res = await app.request(`/api/mcp/linear/auth/callback?code=abc&state=${state}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Connected to linear");
      expect(captured).toEqual({ serverUrl: SERVER_URL, authorizationCode: "abc" });
      expect(replaced).toBe(true);
      expect(events).toContain("config.changed");
    });

    it("renders the provider error, escaped, without touching auth", async () => {
      const res = await buildApp(async () => "AUTHORIZED").request(
        "/api/mcp/linear/auth/callback?error=%3Cscript%3E",
      );
      expect(res.status).toBe(400);
      const body = await res.text();
      expect(body).toContain("&lt;script&gt;");
      expect(body).not.toContain("<script>");
    });

    it("400s when the authorization code is missing", async () => {
      const res = await buildApp(async () => "AUTHORIZED").request("/api/mcp/linear/auth/callback");
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("missing authorization code");
    });

    it("404s for a server that is not an OAuth MCP server", async () => {
      const res = await buildApp(async () => "AUTHORIZED").request(
        "/api/mcp/ghost/auth/callback?code=abc&state=x",
      );
      expect(res.status).toBe(404);
    });

    it("400s on an OAuth state mismatch, before exchanging", async () => {
      writeOauthConfig(env.cwd);
      seedState("linear");
      let called = false;
      const auth: McpAuth = async () => {
        called = true;
        return "AUTHORIZED";
      };
      const res = await buildApp(auth).request(
        "/api/mcp/linear/auth/callback?code=abc&state=wrong-state",
      );
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("state mismatch");
      expect(called).toBe(false);
    });

    it("400s with the message when the code exchange fails", async () => {
      writeOauthConfig(env.cwd);
      const state = seedState("linear");
      const auth: McpAuth = async () => {
        throw new Error("token endpoint rejected the code");
      };
      const res = await buildApp(auth).request(
        `/api/mcp/linear/auth/callback?code=abc&state=${state}`,
      );
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("token endpoint rejected");
    });
  });
});
