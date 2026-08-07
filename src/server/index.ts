import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { loadKiriConfig } from "./config/loader.ts";
import type { ModelsConfig } from "./config/schema.ts";
import type { ConfigStore } from "./config/store.ts";
import type { KiriDb } from "./db/index.ts";
import { EMBEDDED_FILES } from "./embedded-assets.ts";
import { type EventBus, mountEventsRoute, mountRecommendationReflector } from "./events/index.ts";
import type { LlmClients } from "./llm/index.ts";
import type { McpCredentialStore } from "./mcp/oauth-store.ts";
import type { McpRegistry } from "./mcp/registry.ts";
import { activityRoutes } from "./routes/activity.ts";
import { configRoutes } from "./routes/config.ts";
import { type McpAuth, mcpRoutes } from "./routes/mcp.ts";
import { memoriesRoutes } from "./routes/memories.ts";
import { runsRoutes } from "./routes/runs.ts";
import { searchRoutes } from "./routes/search.ts";
import { sessionsRoutes } from "./routes/sessions.ts";
import { mountStaticRoutes } from "./routes/static.ts";
import { systemRoutes } from "./routes/system.ts";
import { workflowsRoutes } from "./routes/workflows.ts";
import type { CancelRegistry } from "./runner/cancel-registry.ts";
import { type StreamRegistry, createToolPermissionStore } from "./sessions/index.ts";
import type { Registry } from "./workflows/index.ts";

/**
 * Dependencies the HTTP API needs to do real work: the state DB, the live
 * workflow registry, and the workspace config passed to the runner.
 *
 * `staticRoot` locates the built SPA bundle on disk. When omitted and the
 * `embedded-assets.ts` module has been populated by the release pipeline
 * (i.e. inside a compiled binary), the SPA is served from memory instead
 * and `staticRoot` is ignored. Tests and `bun start` from this repo
 * pass `staticRoot` explicitly; the empty stub keeps embedded mode
 * dormant on the main branch.
 *
 * `bus`, when supplied, is forwarded to the runner so triggered runs
 * publish lifecycle events to downstream consumers, and mounts
 * `GET /api/events` so clients can stream those events live.
 * `eventsHeartbeatMs` overrides the SSE keep-alive cadence (test hook).
 */
export interface AppDeps {
  db: KiriDb;
  registry: Registry;
  config: ConfigStore;
  staticRoot?: string;
  bus?: EventBus;
  eventsHeartbeatMs?: number;
  /**
   * Cancel registry for in-flight runs. When supplied, triggered runs are
   * registered with it (so their child processes can be reached) and
   * `POST /api/runs/:id/cancel` is mounted. Without it, the cancel route
   * is omitted entirely.
   */
  cancelRegistry?: CancelRegistry;
  /**
   * Registry of in-flight session turn streams, shared so a client that
   * reconnects mid-turn rejoins the live response. Defaults to a fresh registry
   * the session surface owns; supplied mainly for tests.
   */
  streamRegistry?: StreamRegistry;
  /**
   * Completion client forwarded to the runner so `llm:` steps can execute.
   * Without it, llm steps fail cleanly with a not-configured error.
   */
  llmClients?: LlmClients;
  /**
   * MCP server registry whose discovered tools are offered to each session's
   * model. Omitted leaves sessions as a plain chat with no tools.
   */
  mcpRegistry?: McpRegistry;
  /**
   * Credential store backing the MCP OAuth surface. With `mcpAuth` and
   * `mcpRegistry`, mounts `/api/mcp` (status + auth start/callback); omit any
   * of the three to leave that surface off.
   */
  mcpCredentialStore?: McpCredentialStore;
  /** @ai-sdk/mcp's `auth`, injected so the OAuth routes are testable. */
  mcpAuth?: McpAuth;
  /**
   * Inject the embedded-SPA map directly (test seam). Production reads
   * from `embedded-assets.ts`; tests pass a `Map` to exercise the
   * embedded code path without going through `bun build --compile`.
   * Ignored when `staticRoot` is also set — explicit disk path wins.
   */
  embeddedFiles?: Map<string, Uint8Array>;
  /**
   * The kiri version string surfaced on `GET /api/version`. The release
   * pipeline injects the tag (e.g. "v0.1.0") at compile time via
   * `bun build --define KIRI_VERSION=…`; local `bun start` / tests fall
   * back to `"dev"`. Used by the SPA to display the running version and
   * compare against the latest GitHub release.
   */
  version?: string;
  /**
   * Environment the config-health endpoint resolves provider keys against.
   * `bin/kiri.ts` passes `process.env`; defaults to it when omitted.
   */
  env?: Record<string, string | undefined>;
  /**
   * Live LLM provider names, forwarded to the session workflow-authoring
   * tools so an authored `llm:` step validates against the same set the
   * loader uses. Omitted ⇒ authored `llm:` steps are rejected as
   * unknown-provider, matching a workspace with no providers configured.
   */
  getProviderNames?: () => ReadonlySet<string>;
  /**
   * Live sandbox for the session filesystem tools. Defaults to reading
   * `filesystem.allowed_directories` from `kiri.yaml` on each turn — the
   * same fresh-from-disk posture as `kiri.md` — so an edit applies on the
   * next turn. Empty ⇒ the filesystem tools are withheld.
   */
  getAllowedDirectories?: () => readonly string[];
  /**
   * Live default working directory for new sessions. Defaults to reading
   * `filesystem.default_working_directory` (falling back to the first
   * allowed directory) from `kiri.yaml` at each session create, the same
   * fresh-from-disk posture as the sandbox. Absent ⇒ new sessions start
   * without a working directory.
   */
  getDefaultWorkingDirectory?: () => string | undefined;
  /**
   * Live models config for the session surface. Defaults to reading the
   * `models:` section from `kiri.yaml` on each use, the same fresh-from-disk
   * posture as the sandboxes. Empty ⇒ no shortcuts or delegates configured.
   */
  getModelsConfig?: () => ModelsConfig;
}

// Upper bound on request body size. Invoke bodies are
// `Record<string, string>` headed for env vars — real-world inputs fit
// comfortably below 1 KB, so 256 KB is generous insurance against a
// runaway local client hammering `c.req.text()` with an unbounded payload.
const BODY_LIMIT_BYTES = 256 * 1024;

const ALLOWED_ORIGINS = [
  "https://local.kiri.build",
  "http://127.0.0.1:4242",
  "http://localhost:4242",
];

// Custom header required on every state-changing request. Browsers will only
// send it cross-origin after a successful CORS preflight permitting the header,
// so a malicious page in another tab cannot satisfy the check even if the CORS
// allow-list is misconfigured. Presence-only — the value is irrelevant.
const REQUIRED_CLIENT_HEADER = "X-Kiri-Client";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Build the Hono app serving kiri's HTTP API and the built SPA bundle.
 * One process, one origin: the same Hono instance powers the API and
 * serves the static client bundle.
 */
export function createApp(deps: AppDeps): Hono {
  const { db, registry, config, bus, eventsHeartbeatMs, cancelRegistry, llmClients, mcpRegistry } =
    deps;
  const version = deps.version ?? "dev";
  const env = deps.env ?? process.env;
  const embeddedFiles = deps.embeddedFiles ?? EMBEDDED_FILES;
  const app = new Hono();

  // One file-backed permission store shared by the session turn loop (which
  // enforces it) and the MCP surface (which lists and sets it). Stateless over a
  // config-derived path, so a single instance keeps both reading the same file.
  const toolPermissions = createToolPermissionStore(config.toolPermissionsFile());

  // CORS allow-list for the hosted shell at https://local.kiri.build plus the
  // local-direct origins. Mounted before route handlers so OPTIONS preflight is
  // answered by the middleware rather than falling through. Disallowed origins
  // get no Access-Control-Allow-Origin header — the browser default-blocks.
  app.use(
    "*",
    cors({
      origin: ALLOWED_ORIGINS,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", REQUIRED_CLIENT_HEADER],
    }),
  );

  // Cheap insurance against a runaway local client hammering `c.req.text()`
  // with an unbounded payload. `bodyLimit` short-circuits on bodyless
  // requests (GET/HEAD/OPTIONS), so scoping to `/api/*` is for clarity, not
  // necessity. The custom `onError` keeps the 413 body on the same
  // `{ error }` contract every other 4xx in the app honours.
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
  );

  // Belt-and-braces CSRF defence layered on top of the CORS allow-list.
  // Custom headers force a CORS preflight; a cross-origin attacker can't
  // satisfy it without an explicit Access-Control-Allow-Headers permitting
  // the header — so even if the CORS allow-list ever drifts, state-changing
  // requests from disallowed origins are still rejected here.
  //
  // Deliberate hole: `GET /api/mcp/:server/auth/callback` mutates state (it
  // exchanges the OAuth code for tokens) yet is exempt here because it is a
  // top-level provider redirect — a GET, which can't carry the header. Its CSRF
  // defence is the OAuth `state` param instead, checked against the stored value.
  app.use("*", async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (!c.req.header(REQUIRED_CLIENT_HEADER)) {
      return c.json({ error: `${REQUIRED_CLIENT_HEADER} header required` }, 403);
    }
    return next();
  });

  // Honour the `{ error: string }` contract for unmatched routes and uncaught
  // throws. `HTTPException` carries its own status/message verbatim so handlers
  // can `throw new HTTPException(404, …)` instead of catching defensively;
  // anything else is logged and surfaced as an opaque 500 so internal detail
  // (SQL fragments, stack frames) doesn't leak to the client.
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "internal server error" }, 500);
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.route("/api", systemRoutes({ version }));
  // Mounted unconditionally — it reports *why* the workspace may have no
  // providers, so it must answer even when the session surface is absent.
  app.route("/api/config", configRoutes({ config, env, llmClients }));
  app.route(
    "/api/workflows",
    workflowsRoutes({ db, registry, config, bus, cancelRegistry, llmClients }),
  );
  app.route("/api/runs", runsRoutes({ db, registry, config, bus, cancelRegistry, llmClients }));
  app.route("/api/activity", activityRoutes({ db, registry }));
  app.route("/api/search", searchRoutes({ db, registry }));
  app.route("/api/memories", memoriesRoutes({ db, bus }));

  // Sessions resolve, stream, and list models off `llmClients`; without it the
  // surface is inert, so its routes (and `/api/models`) only mount when present.
  if (llmClients) {
    app.route(
      "/api",
      sessionsRoutes({
        db,
        config,
        registry,
        llmClients,
        bus,
        cancelRegistry,
        mcpRegistry,
        toolPermissions,
        streamRegistry: deps.streamRegistry,
        getProviderNames: deps.getProviderNames,
        getAllowedDirectories:
          deps.getAllowedDirectories ?? (() => loadKiriConfig(config, env).allowedDirectories),
        getDefaultWorkingDirectory:
          deps.getDefaultWorkingDirectory ??
          (() => loadKiriConfig(config, env).defaultWorkingDirectory),
        getModelsConfig: deps.getModelsConfig ?? (() => loadKiriConfig(config, env).models),
      }),
    );
  }

  // MCP OAuth surface: per-server status plus the browser sign-in start/callback.
  // Needs the registry (to report status and reconnect), the credential store,
  // and the injected `auth` — all three or it stays unmounted.
  if (mcpRegistry && deps.mcpCredentialStore && deps.mcpAuth) {
    app.route(
      "/api/mcp",
      mcpRoutes({
        config,
        env,
        registry: mcpRegistry,
        permissions: toolPermissions,
        credentialStore: deps.mcpCredentialStore,
        auth: deps.mcpAuth,
        bus,
      }),
    );
  }

  if (bus) {
    mountEventsRoute(
      app,
      eventsHeartbeatMs === undefined ? { bus } : { bus, heartbeatMs: eventsHeartbeatMs },
    );
    // Reflect a spawned run's status back onto the recommendation that
    // actioned it, so the producing run's detail refreshes its rec badge.
    mountRecommendationReflector(db, bus);
  }

  mountStaticRoutes(app, { staticRoot: deps.staticRoot, embeddedFiles });

  return app;
}
