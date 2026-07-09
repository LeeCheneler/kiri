import { zValidator } from "@hono/zod-validator";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Hono } from "hono";
import { z } from "zod";
import { loadKiriConfig } from "../config/loader.ts";
import type { ConfigStore } from "../config/store.ts";
import type { EventBus } from "../events/index.ts";
import type { McpCredentialStore } from "../mcp/oauth-store.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import type { McpHttpServer } from "../mcp/schema.ts";
import { BUILTIN_TOOLS, type ToolPermissionStore } from "../sessions/index.ts";
import { onZodFail } from "./shared.ts";

/**
 * The subset of the official MCP SDK's `auth` this surface calls: kick off
 * authorization (no code) or complete it (with `authorizationCode`). Injected so
 * the routes are tested with a fake — no discovery, registration, or network.
 * The official `auth` does no CSRF check, so the callback validates the OAuth
 * `state` itself before calling it.
 */
export type McpAuth = (
  provider: OAuthClientProvider,
  options: { serverUrl: string | URL; authorizationCode?: string },
) => Promise<"AUTHORIZED" | "REDIRECT">;

export interface McpRoutesDeps {
  /** Workspace config — read fresh per request to resolve a server's URL and OAuth flag. */
  config: ConfigStore;
  /** Environment the config loader resolves `{ env: }` refs against. */
  env: Record<string, string | undefined>;
  /** Live MCP registry — its per-server status and tool catalog are served, and it is reconnected after sign-in. */
  registry: McpRegistry;
  /** Standing per-tool permissions — read into the tool listing and set from it. */
  permissions: ToolPermissionStore;
  /** Issues the file-backed OAuth provider for a server. */
  credentialStore: McpCredentialStore;
  /** @ai-sdk/mcp's `auth`, injected as a seam. */
  auth: McpAuth;
  bus?: EventBus;
}

// Setting a tool's standing permission: its namespaced `<server>__<tool>` name
// and the verdict to record. `"ask"` clears any recorded decision.
const toolPermissionBodySchema = z
  .object({ tool: z.string().min(1), permission: z.enum(["allow", "ask", "off"]) })
  .strict();

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Minimal self-contained HTML for the OAuth result tab (not the SPA). */
const page = (title: string, heading: string, body: string): string =>
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · kiri</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5;">
<h1>${escapeHtml(heading)}</h1>
<p>${body}</p>
<p>You can close this tab and return to kiri.</p>
</body>
</html>`;

const successHtml = (name: string): string =>
  page("MCP sign-in complete", `Connected to ${escapeHtml(name)}`, "Sign-in complete.");

const errorHtml = (name: string, message: string): string =>
  page("MCP sign-in failed", `Couldn't connect ${escapeHtml(name)}`, escapeHtml(message));

/**
 * Build the Hono sub-app for the MCP OAuth surface. Mounted under `/api/mcp`:
 * `GET /servers` reports per-server status for the UI, `GET /:server/auth/start`
 * kicks off OAuth and redirects the browser to the provider, and
 * `GET /:server/auth/callback` completes it and reconnects the server.
 */
export function mcpRoutes(deps: McpRoutesDeps): Hono {
  const { config, env, registry, permissions, credentialStore, auth, bus } = deps;
  const app = new Hono();

  /** Resolve `name` to its OAuth http server config, or undefined when it isn't one. */
  const oauthServer = (name: string): McpHttpServer | undefined => {
    const server = loadKiriConfig(config, env).mcp.get(name);
    return server?.type === "http" && server.oauth ? server : undefined;
  };

  /** Reconnect all servers (the just-authed one now has tokens) and signal the UI. */
  const reconnect = async (): Promise<void> => {
    await registry.replace(loadKiriConfig(config, env).mcp, env);
    bus?.publish({ type: "config.changed" });
  };

  app.get("/servers", (c) => c.json({ servers: registry.status() }));

  // The per-server tool listing for the MCP management surface: every configured
  // server with its connection state, and (when connected) its tools, each
  // carrying the standing permission the user has set. Read live so a reconnect
  // or a permission change is reflected on the next fetch.
  app.get("/tools", (c) => {
    const toolsByServer = new Map(registry.catalog().map((s) => [s.name, s.tools]));
    const servers = registry.status().map((server) => ({
      name: server.name,
      type: server.type,
      state: server.state,
      error: server.error,
      tools: (toolsByServer.get(server.name) ?? []).map((tool) => ({
        name: tool.name,
        namespacedName: tool.namespacedName,
        description: tool.description,
        permission: permissions.get(tool.namespacedName),
      })),
    }));
    // Every built-in session tool rides alongside, so its standing permission
    // is reviewable and reversible from the same surface. A tool with no
    // recorded decision reports its own declared default.
    const builtin = BUILTIN_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      permission: permissions.get(tool.name, tool.defaultPermission),
    }));
    return c.json({ servers, builtin });
  });

  // Set a tool's standing permission (allow/ask/off), keyed by its namespaced
  // name. Workspace-scoped, not per-session, and applied from the next turn.
  app.post(
    "/tool-permissions",
    zValidator("json", toolPermissionBodySchema, onZodFail("invalid permission")),
    (c) => {
      const { tool, permission } = c.req.valid("json");
      permissions.set(tool, permission);
      // Announce the write so every open tool listing reflects it, not just the
      // one that made the change.
      bus?.publish({ type: "tool.permission.updated", tool });
      return c.body(null, 204);
    },
  );

  app.get("/:server/auth/start", async (c) => {
    const name = c.req.param("server");
    const server = oauthServer(name);
    if (!server) return c.html(errorHtml(name, `no OAuth MCP server named "${name}"`), 404);

    const provider = credentialStore.providerFor(name);
    try {
      const result = await auth(provider, { serverUrl: server.url });
      // Already authorized (valid tokens): nothing to sign into — just reconnect.
      if (result === "AUTHORIZED") {
        await reconnect();
        return c.html(successHtml(name));
      }
      const url = provider.takeAuthorizationUrl();
      if (!url) return c.html(errorHtml(name, "no authorization URL was produced"), 502);
      return c.redirect(url.toString());
    } catch (cause) {
      return c.html(errorHtml(name, cause instanceof Error ? cause.message : String(cause)), 502);
    }
  });

  // The OAuth provider redirects the browser here as a top-level navigation, so
  // it cannot carry the `X-Kiri-Client` header the state-changing gate wants —
  // and as a GET it is exempt from that gate anyway. This callback nonetheless
  // mutates state (it exchanges the code and stores tokens); its CSRF defence is
  // the OAuth `state` param, which the SDK checks against the stored value.
  app.get("/:server/auth/callback", async (c) => {
    const name = c.req.param("server");
    const providerError = c.req.query("error");
    if (providerError) return c.html(errorHtml(name, providerError), 400);

    const code = c.req.query("code");
    if (!code) return c.html(errorHtml(name, "missing authorization code"), 400);

    const server = oauthServer(name);
    if (!server) return c.html(errorHtml(name, `no OAuth MCP server named "${name}"`), 404);

    const provider = credentialStore.providerFor(name);
    // The official auth() performs no CSRF check, so validate the OAuth state here
    // against the value persisted when the sign-in started.
    const state = c.req.query("state");
    if (state === undefined || state !== provider.storedState()) {
      return c.html(errorHtml(name, "OAuth state mismatch — start the sign-in again"), 400);
    }
    try {
      await auth(provider, { serverUrl: server.url, authorizationCode: code });
      await reconnect();
      return c.html(successHtml(name));
    } catch (cause) {
      return c.html(errorHtml(name, cause instanceof Error ? cause.message : String(cause)), 400);
    }
  });

  return app;
}
