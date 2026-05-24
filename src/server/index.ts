import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { KiriDb } from "./db/index.ts";
import { EMBEDDED_FILES } from "./embedded-assets.ts";
import { type EventBus, mountEventsRoute } from "./events/index.ts";
import { articlesRoutes } from "./routes/articles.ts";
import { runsRoutes } from "./routes/runs.ts";
import { systemRoutes } from "./routes/system.ts";
import { workflowsRoutes } from "./routes/workflows.ts";
import type { CancelRegistry } from "./runner/cancel-registry.ts";
import type { Registry } from "./workflows/index.ts";

/**
 * Dependencies the HTTP API needs to do real work: the state DB, the live
 * workflow registry, and the repo root passed to the runner.
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
  cwd: string;
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
}

const DEFAULT_STATIC_ROOT = "./dist/client";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const contentTypeFor = (path: string): string => {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
};

// Hashed bundle chunks under /assets/ carry content hashes in their name,
// so they're safe to cache aggressively. Anything else (SPA shell + the
// stable-named entry chunks) revalidates every load.
const isHashedAsset = (path: string): boolean => path.startsWith("/assets/");
const cacheControlFor = (path: string): string =>
  isHashedAsset(path) ? "public, max-age=31536000, immutable" : "no-store";

// Upper bound on request body size. Invoke bodies are
// `Record<string, string>` headed for env vars — real-world inputs fit
// comfortably below 1 KB, so 256 KB is generous insurance against a
// runaway local client hammering `c.req.text()` with an unbounded payload.
const BODY_LIMIT_BYTES = 256 * 1024;

const NO_STORE_PATHS = new Set(["/", "/index.html", "/app.js", "/app.css"]);

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
  const { db, registry, cwd, bus, eventsHeartbeatMs, cancelRegistry } = deps;
  const version = deps.version ?? "dev";
  // When the caller doesn't pin a disk path and the binary carries an
  // embedded SPA (release pipeline overwrites `embedded-assets.ts` before
  // compile), serve from memory. Otherwise fall back to disk so dev,
  // tests, and `bun start` from this repo keep working off `dist/client`.
  const embeddedFiles = deps.embeddedFiles ?? EMBEDDED_FILES;
  const useEmbedded = deps.staticRoot === undefined && embeddedFiles.size > 0;
  const staticRoot = useEmbedded ? null : (deps.staticRoot ?? DEFAULT_STATIC_ROOT);
  const app = new Hono();

  // CORS allow-list for the hosted shell at https://local.kiri.build plus the
  // local-direct origins. Mounted before route handlers so OPTIONS preflight is
  // answered by the middleware rather than falling through. Disallowed origins
  // get no Access-Control-Allow-Origin header — the browser default-blocks.
  app.use(
    "*",
    cors({
      origin: ALLOWED_ORIGINS,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
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

  app.route("/api/workflows", workflowsRoutes({ db, registry, cwd, bus, cancelRegistry }));

  app.route("/api/runs", runsRoutes({ db, registry, cwd, bus, cancelRegistry }));

  app.route("/api/articles", articlesRoutes({ db }));

  if (bus) {
    mountEventsRoute(
      app,
      eventsHeartbeatMs === undefined ? { bus } : { bus, heartbeatMs: eventsHeartbeatMs },
    );
  }

  // The SPA shell ships at stable paths (/, /app.js, /app.css), so there is no
  // content hash to bust the browser cache when kiri serves an updated bundle.
  // Force revalidation via Cache-Control. Hashed assets under /assets/ are
  // immutable and stay freely cacheable.
  app.use("*", async (c, next) => {
    await next();
    if (NO_STORE_PATHS.has(c.req.path)) c.header("Cache-Control", "no-store");
  });

  if (staticRoot === null) {
    // Embedded SPA — assets baked into the compiled binary at release
    // time. One handler covers everything: it looks the request path up
    // in the map (mapping `/` to `/index.html`), falls back to the shell
    // for unmatched client-side routes, and infers the Content-Type and
    // cache policy from the path so future assets (images, fonts, hashed
    // chunks under /assets/) need zero code changes.
    app.get("*", (c, next) => {
      const path = c.req.path;
      if (path.startsWith("/api/")) return next();

      const lookup = path === "/" ? "/index.html" : path;
      const bytes = embeddedFiles.get(lookup);
      if (bytes !== undefined) {
        c.header("Cache-Control", cacheControlFor(lookup));
        // Cast: Hono's c.body wants Uint8Array<ArrayBuffer> specifically;
        // the bytes we hold are always ArrayBuffer-backed (TextEncoder /
        // literal constructor / atob), never SharedArrayBuffer.
        return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
          "Content-Type": contentTypeFor(lookup),
        });
      }

      // Client-side route (e.g. /runs/:id): return the shell so refresh
      // boots the SPA. Same no-store policy as the stable-named entry chunks.
      const shell = embeddedFiles.get("/index.html");
      if (shell === undefined) return next();
      c.header("Cache-Control", "no-store");
      return c.body(shell as Uint8Array<ArrayBuffer>, 200, {
        "Content-Type": "text/html; charset=utf-8",
      });
    });
  } else {
    // Disk-served SPA — dev, tests, and `bun start` from this repo. Hono's
    // serveStatic finalises the response when a file matches and otherwise
    // calls next(), so unknown paths fall through to the SPA shell below.
    app.use("*", serveStatic({ root: staticRoot }));

    // SPA fallback for client-side routes. serveStatic above doesn't rewrite
    // unknown paths to index.html, so a refresh on /runs/:id would 404. Catch
    // any unmatched GET that isn't an API call or a hashed asset and return
    // the SPA shell. Same bytes as /index.html, so the same no-store policy
    // applies — a fresh shell every load means client updates propagate.
    app.get("*", (c, next) => {
      if (c.finalized) return next();
      const path = c.req.path;
      if (path.startsWith("/api/") || path.startsWith("/assets/")) return next();
      c.header("Cache-Control", "no-store");
      return serveStatic({ root: staticRoot, path: "index.html" })(c, next);
    });
  }

  return app;
}
