import { rmSync } from "node:fs";
import { join } from "node:path";
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { z } from "zod";
import { resolvePublishTitle } from "../shared/publish-title.ts";
import type { KiriDb } from "./db/index.ts";
import { runArtefacts, runSteps, runs } from "./db/schema.ts";
import { EMBEDDED_FILES } from "./embedded-assets.ts";
import { type EventBus, mountEventsRoute } from "./events/index.ts";
import type { CancelRegistry } from "./runner/cancel-registry.ts";
import { runWorkflow } from "./runner/index.ts";
import type { Registry, WorkflowDefinition } from "./workflows/index.ts";
import { publishNameSchema } from "./workflows/schema.ts";

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

const summarizeWorkflow = (def: WorkflowDefinition) => ({
  name: def.name,
  steps: def.steps,
  gating: def.gating,
  schedule: def.schedule,
  // Absence (no `publish:` / `summarize:` field, or `publish: []`) collapses
  // to `undefined` so the client has a single "section not present" signal.
  publish:
    def.publish && def.publish.length > 0
      ? def.publish.map((entry) => ({
          ...entry,
          title: resolvePublishTitle(entry.name, entry.title),
        }))
      : undefined,
  summarize: def.summarize,
});

const DEFAULT_RUN_LIMIT = 25;
const MAX_RUN_LIMIT = 100;

const runListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_RUN_LIMIT).default(DEFAULT_RUN_LIMIT),
});

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
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", REQUIRED_CLIENT_HEADER],
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

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.get("/api/workflows", (c) => c.json(registry.listWorkflows().map(summarizeWorkflow)));

  app.post("/api/workflows/:name/runs", (c) => {
    const name = c.req.param("name");
    const wf = registry.getWorkflow(name);
    if (!wf) return c.json({ error: `workflow "${name}" not found` }, 404);
    const { runId, done } = runWorkflow(db, wf, {
      cwd,
      trigger: "manual",
      bus,
      cancelRegistry,
    });
    // Background execution: log unhandled rejections so they don't trip the
    // process-wide handler. The run row is finalised inside `done` before any
    // re-throw, so the DB stays consistent regardless.
    done.catch((cause) => {
      console.error(`run ${runId} crashed: ${cause instanceof Error ? cause.message : cause}`);
    });
    return c.json({ runId, status: "running" }, 202);
  });

  if (cancelRegistry) {
    app.post("/api/runs/:id/cancel", (c) => {
      const id = c.req.param("id");
      const run = db.select().from(runs).where(eq(runs.id, id)).get();
      if (!run) return c.json({ error: `run "${id}" not found` }, 404);
      if (run.status !== "running") {
        return c.json({ error: `run "${id}" is not in flight` }, 409);
      }
      // requestCancel returns false only if the registry has no entry — i.e.
      // the runner already released it in the small window between our DB
      // read above and this call. Treat as already-terminal.
      if (!cancelRegistry.requestCancel(id)) {
        return c.json({ error: `run "${id}" is not in flight` }, 409);
      }
      return c.json({ runId: id }, 202);
    });
  }

  app.delete("/api/runs/:id", (c) => {
    const id = c.req.param("id");
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: `run "${id}" not found` }, 404);
    if (run.status === "running") {
      return c.json({ error: `run "${id}" is in flight; cancel it first` }, 409);
    }
    // Explicit cascade in a transaction: artefacts and step rows hold FKs
    // to the parent run row, so they go first. Matches the rest of the
    // codebase's pattern of in-code cascades instead of schema-level
    // ON DELETE CASCADE.
    db.transaction((tx) => {
      tx.delete(runArtefacts).where(eq(runArtefacts.runId, id)).run();
      tx.delete(runSteps).where(eq(runSteps.runId, id)).run();
      tx.delete(runs).where(eq(runs.id, id)).run();
    });
    // Catches scratch-dir leftovers from a crashed runner; on a normal
    // run the dir is already gone, and `force: true` makes that a no-op.
    rmSync(join(cwd, ".kiri", "runs", id), { recursive: true, force: true });
    bus?.publish({ type: "run.deleted", id });
    return c.body(null, 204);
  });

  app.post("/api/runs/:id/rerun", (c) => {
    const id = c.req.param("id");
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: `run "${id}" not found` }, 404);
    if (run.status === "running") {
      return c.json({ error: `run "${id}" is in flight; cancel it first` }, 409);
    }
    const wf = registry.getWorkflow(run.workflowName);
    if (!wf) {
      return c.json(
        { error: `workflow "${run.workflowName}" no longer exists; re-create it first` },
        409,
      );
    }
    // Cascade-wipe artefacts + step rows (mirrors the delete path, minus
    // the final `runs` delete) so the rerun starts with a clean slate
    // under the same run id. Scratch dir is removed too — normally already
    // gone, but a crashed runner can leave it behind.
    db.transaction((tx) => {
      tx.delete(runArtefacts).where(eq(runArtefacts.runId, id)).run();
      tx.delete(runSteps).where(eq(runSteps.runId, id)).run();
    });
    rmSync(join(cwd, ".kiri", "runs", id), { recursive: true, force: true });
    const { done } = runWorkflow(db, wf, {
      cwd,
      trigger: run.trigger,
      bus,
      cancelRegistry,
      runId: id,
    });
    done.catch((cause) => {
      console.error(`run ${id} crashed: ${cause instanceof Error ? cause.message : cause}`);
    });
    return c.json({ runId: id, status: "running" }, 202);
  });

  app.get("/api/runs", (c) => {
    const parsed = runListQuerySchema.safeParse({
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid query" }, 400);
    }
    const { cursor, limit } = parsed.data;

    // Keyset pagination on the compound key (started_at DESC, id DESC). The
    // cursor is the last seen run's id; we look it up to resolve its
    // started_at and then page strictly after that point.
    let anchor: { startedAt: Date; id: string } | undefined;
    if (cursor !== undefined) {
      const found = db
        .select({ startedAt: runs.startedAt, id: runs.id })
        .from(runs)
        .where(eq(runs.id, cursor))
        .get();
      if (!found) return c.json({ error: `cursor "${cursor}" not found` }, 400);
      anchor = found;
    }

    const rows = db
      .select()
      .from(runs)
      .where(
        anchor
          ? or(
              lt(runs.startedAt, anchor.startedAt),
              and(eq(runs.startedAt, anchor.startedAt), lt(runs.id, anchor.id)),
            )
          : undefined,
      )
      .orderBy(desc(runs.startedAt), desc(runs.id))
      .limit(limit)
      .all();

    const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;

    // Single aggregation across the page rather than per-row N+1. Empty page
    // skips the query entirely so the common no-artefacts feed pays nothing.
    type ArtefactProjection = { name: string; title: string; createdAt: Date };
    const artefactsByRunId = new Map<string, ArtefactProjection[]>();
    if (rows.length > 0) {
      const allArtefacts = db
        .select({
          runId: runArtefacts.runId,
          name: runArtefacts.name,
          title: runArtefacts.title,
          createdAt: runArtefacts.createdAt,
        })
        .from(runArtefacts)
        .where(
          inArray(
            runArtefacts.runId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(runArtefacts.createdAt))
        .all();
      for (const { runId, name, title, createdAt } of allArtefacts) {
        const list = artefactsByRunId.get(runId);
        const entry: ArtefactProjection = { name, title, createdAt };
        if (list) list.push(entry);
        else artefactsByRunId.set(runId, [entry]);
      }
    }

    return c.json({
      runs: rows.map((row) => ({
        ...row,
        isInterrupted: !registry.getWorkflow(row.workflowName),
        artefacts: artefactsByRunId.get(row.id) ?? [],
      })),
      nextCursor,
    });
  });

  app.get("/api/runs/:id/published/:name", (c) => {
    const id = c.req.param("id");
    const name = c.req.param("name");
    const parsedName = publishNameSchema.safeParse(name);
    if (!parsedName.success) {
      return c.json({ error: parsedName.error.issues[0]?.message ?? "invalid artefact name" }, 400);
    }
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: `run "${id}" not found` }, 404);
    const artefact = db
      .select()
      .from(runArtefacts)
      .where(and(eq(runArtefacts.runId, id), eq(runArtefacts.name, name)))
      .get();
    if (!artefact) {
      return c.json({ error: `artefact "${name}" not found on run "${id}"` }, 404);
    }
    return c.json({
      id: artefact.id,
      runId: artefact.runId,
      name: artefact.name,
      title: artefact.title,
      contentMd: artefact.contentMd,
      createdAt: artefact.createdAt,
      workflowName: run.workflowName,
    });
  });

  app.get("/api/runs/:id", (c) => {
    const id = c.req.param("id");
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: `run "${id}" not found` }, 404);
    // Publish and summary rows ship alongside pipeline steps; clients
    // separate them by the `isPublish` / `isSummary` flags. This is what
    // lets the run detail page render in-flight publish indicators while
    // an artefact row hasn't yet been written.
    const steps = db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, id))
      .orderBy(asc(runSteps.index))
      .all();
    // `content_md` is deliberately omitted — the artefact body is fetched
    // by the dedicated artefact page so the run-detail payload stays small.
    // Lives on `run.artefacts` so every RunListEntry — list or detail —
    // shares the same shape; chip rendering and the published-section row
    // both read from one place.
    const artefacts = db
      .select({
        name: runArtefacts.name,
        title: runArtefacts.title,
        createdAt: runArtefacts.createdAt,
      })
      .from(runArtefacts)
      .where(eq(runArtefacts.runId, id))
      .orderBy(asc(runArtefacts.createdAt))
      .all();
    return c.json({
      run: { ...run, isInterrupted: !registry.getWorkflow(run.workflowName), artefacts },
      steps,
    });
  });

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
