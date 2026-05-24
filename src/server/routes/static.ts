import type { Hono } from "hono";
import { serveStatic } from "hono/bun";

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

const NO_STORE_PATHS = new Set(["/", "/index.html", "/app.js", "/app.css"]);

export interface MountStaticRoutesOptions {
  /**
   * Explicit disk root for the built SPA. When set, `embeddedFiles` is
   * ignored even if populated. When `undefined` and `embeddedFiles` is
   * non-empty, the SPA is served from memory instead. When both are
   * unset the disk default (`./dist/client`) is used.
   */
  staticRoot?: string;
  embeddedFiles: Map<string, Uint8Array>;
}

/**
 * Mount the SPA-serving middleware on `app`: a no-store cache-control
 * pass for the stable-named shell paths, then either an embedded-assets
 * handler (release binary) or Hono's `serveStatic` plus an SPA shell
 * fallback (dev, tests, `bun start`).
 *
 * Attaches to `app` rather than mounting via `app.route()` because the
 * static handler covers `*` and pairs awkwardly with sub-app composition.
 */
export function mountStaticRoutes(app: Hono, opts: MountStaticRoutesOptions): void {
  const { embeddedFiles } = opts;
  const useEmbedded = opts.staticRoot === undefined && embeddedFiles.size > 0;
  const staticRoot = useEmbedded ? null : (opts.staticRoot ?? DEFAULT_STATIC_ROOT);

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
    return;
  }

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
