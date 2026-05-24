import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { bootstrap } from "./bootstrap.ts";
import type { KiriDb } from "./db/index.ts";
import { articles, runSteps, runs } from "./db/schema.ts";
import { type KiriEvent, createEventBus } from "./events/index.ts";
import { createApp } from "./index.ts";
import { type CancelRegistry, createCancelRegistry } from "./runner/cancel-registry.ts";
import { type Registry, type WorkflowDefinition, createRegistry } from "./workflows/index.ts";

describe("createApp", () => {
  let cwd: string;
  let db: KiriDb;
  let registry: Registry;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-app-"));
    db = bootstrap(cwd);
    registry = createRegistry();
  });

  afterEach(() => {
    db.$client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  const writeBundle = (name: string, body: string): string => {
    const dir = join(cwd, "scripts", name);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "run.sh");
    writeFileSync(path, body);
    chmodSync(path, 0o755);
    return path;
  };

  // The trigger endpoint returns 202 the moment the run row is inserted —
  // execution continues in the background. Tests that assert on terminal
  // state need a way to wait for the run to actually finish; an event-bus
  // subscriber set up before triggering is the most reliable signal.
  const setupRunWaiter = () => {
    const bus = createEventBus();
    const finished = new Set<string>();
    const pending = new Map<string, () => void>();
    bus.subscribe((e) => {
      if (e.type !== "run.finished") return;
      finished.add(e.id);
      pending.get(e.id)?.();
      pending.delete(e.id);
    });
    const waitForFinished = (runId: string): Promise<void> => {
      if (finished.has(runId)) return Promise.resolve();
      return new Promise((resolve) => {
        pending.set(runId, resolve);
      });
    };
    return { bus, waitForFinished };
  };

  const CLIENT_HEADERS = { "X-Kiri-Client": "kiri-ui" };

  describe("GET /api/articles/recent", () => {
    const seedRun = (id: string, workflowName: string) => {
      db.insert(runs)
        .values({
          id,
          workflowName,
          status: "ok",
          trigger: "manual",
          startedAt: new Date(),
          finishedAt: new Date(),
          definitionSnapshot: { name: workflowName, steps: [{ sh: "echo hi" }] },
        })
        .run();
    };

    const seedArticle = (
      runId: string,
      name: string,
      opts: { title?: string; createdAt: Date },
    ) => {
      db.insert(articles)
        .values({
          id: crypto.randomUUID(),
          runId,
          name,
          title: opts.title ?? name,
          contentMd: `# ${name}`,
          createdAt: opts.createdAt,
        })
        .run();
    };

    it("returns an empty array when nothing has been published", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/articles/recent");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("returns the 5 newest articles across runs, newest first, with the workflow name", async () => {
      seedRun("run-a", "alpha");
      seedRun("run-b", "beta");
      // Six articles across two runs with distinct, increasing timestamps
      // so the newest-first ordering is deterministic.
      const base = Date.UTC(2026, 0, 1, 12, 0, 0);
      seedArticle("run-a", "a1", { createdAt: new Date(base + 1000) });
      seedArticle("run-a", "a2", { createdAt: new Date(base + 2000) });
      seedArticle("run-b", "b1", { title: "Beta One", createdAt: new Date(base + 3000) });
      seedArticle("run-a", "a3", { createdAt: new Date(base + 4000) });
      seedArticle("run-b", "b2", { createdAt: new Date(base + 5000) });
      seedArticle("run-b", "b3", { createdAt: new Date(base + 6000) });

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/articles/recent");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        runId: string;
        name: string;
        title: string;
        createdAt: string;
        workflowName: string;
      }>;

      // Newest first, capped at 5 — the oldest article (a1) is excluded.
      expect(body.map((a) => a.name)).toEqual(["b3", "b2", "a3", "b1", "a2"]);
      expect(body[0]).toEqual({
        runId: "run-b",
        name: "b3",
        title: "b3",
        createdAt: new Date(base + 6000).toISOString(),
        workflowName: "beta",
      });
      // The joined workflow name travels with each entry.
      expect(body.find((a) => a.name === "b1")?.workflowName).toBe("beta");
      expect(body.find((a) => a.name === "a3")?.workflowName).toBe("alpha");
      // Link metadata only — the markdown body is not in the payload.
      for (const entry of body) {
        expect(entry).not.toHaveProperty("contentMd");
      }
    });
  });

  describe("Cache-Control on stable-path SPA assets", () => {
    it("sends no-store on /app.js, /app.css, /, and /index.html", async () => {
      const app = createApp({ db, registry, cwd });
      for (const path of ["/app.js", "/app.css", "/", "/index.html"]) {
        const res = await app.request(path);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
      }
    });

    it("does not send no-store on hashed /assets/* paths", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/assets/anything-abc123.js");
      expect(res.headers.get("Cache-Control")).toBeNull();
    });

    it("does not send no-store on /api routes", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/health");
      expect(res.headers.get("Cache-Control")).toBeNull();
    });
  });

  describe("CORS allow-list", () => {
    const ALLOWED = ["https://local.kiri.build", "http://127.0.0.1:4242", "http://localhost:4242"];

    it("echoes the origin on /api responses for every allowed origin", async () => {
      const app = createApp({ db, registry, cwd });
      for (const origin of ALLOWED) {
        const res = await app.request("/api/health", { headers: { Origin: origin } });
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      }
    });

    it("echoes the origin on stable-path static assets", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/app.js", {
        headers: { Origin: "https://local.kiri.build" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://local.kiri.build");
    });

    it("omits CORS headers for disallowed origins", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/health", {
        headers: { Origin: "https://evil.example" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("answers OPTIONS preflight on /api/workflows/:name/runs with 204 and the allow-* headers", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows/anything/runs", {
        method: "OPTIONS",
        headers: {
          Origin: "https://local.kiri.build",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type, X-Kiri-Client",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://local.kiri.build");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-Kiri-Client");
    });

    it("answers OPTIONS preflight on DELETE /api/runs/:id with 204 and permits the DELETE method", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs/anything", {
        method: "OPTIONS",
        headers: {
          Origin: "https://local.kiri.build",
          "Access-Control-Request-Method": "DELETE",
          "Access-Control-Request-Headers": "X-Kiri-Client",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://local.kiri.build");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-Kiri-Client");
    });
  });

  describe("X-Kiri-Client gate", () => {
    it("rejects state-changing requests without the header with 403", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows/anything/runs", { method: "POST" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "X-Kiri-Client header required" });
    });

    it("accepts state-changing requests when the header is present (any value)", async () => {
      writeBundle("k", "#!/bin/sh\necho k\n");
      const wf: WorkflowDefinition = {
        name: "kept",
        steps: [{ use: "k" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const res = await app.request("/api/workflows/kept/runs", {
        method: "POST",
        headers: { "X-Kiri-Client": "anything" },
      });
      expect(res.status).toBe(202);
      // Drain the background run so afterEach doesn't close the DB while it's
      // still writing — closed-handle errors would log even though the test
      // itself passed.
      const { runId } = (await res.json()) as { runId: string };
      await waitForFinished(runId);
    });

    it("does not require the header on safe (GET) requests", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/events", () => {
    it("is mounted when a bus is supplied", async () => {
      const bus = createEventBus();
      const app = createApp({ db, registry, cwd, bus });
      const res = await app.request("/api/events");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
      await res.body?.cancel();
    });

    it("is not mounted when no bus is supplied", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/events");
      expect(res.status).toBe(404);
    });
  });

  describe("SPA shell fallback", () => {
    const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';

    const writeShell = () => {
      const root = join(cwd, "client");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "index.html"), SHELL);
      return root;
    };

    it("serves the SPA shell on a client-side route so refresh boots the app", async () => {
      const staticRoot = writeShell();
      const app = createApp({ db, registry, cwd, staticRoot });

      const res = await app.request("/runs/abc-123");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe(SHELL);
    });

    it("does not intercept unknown /api/* paths", async () => {
      const staticRoot = writeShell();
      const app = createApp({ db, registry, cwd, staticRoot });

      const res = await app.request("/api/nope");
      expect(res.status).toBe(404);
    });

    it("does not intercept hashed /assets/* paths", async () => {
      const staticRoot = writeShell();
      const app = createApp({ db, registry, cwd, staticRoot });

      const res = await app.request("/assets/missing-abc123.js");
      expect(res.status).toBe(404);
    });

    it("falls through when the SPA shell is not built", async () => {
      const staticRoot = join(cwd, "missing-dist");
      const app = createApp({ db, registry, cwd, staticRoot });

      const res = await app.request("/runs/abc-123");
      expect(res.status).toBe(404);
    });

    it("does not run for non-GET methods on client-side routes", async () => {
      const staticRoot = writeShell();
      const app = createApp({ db, registry, cwd, staticRoot });

      const res = await app.request("/runs/abc-123", {
        method: "POST",
        headers: { "X-Kiri-Client": "kiri-ui" },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("embedded SPA", () => {
    const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';
    const JS = 'console.log("hi");';
    const CSS = "body { color: red; }";
    // 8-byte PNG signature — proves binary roundtrips through the handler.
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const enc = (s: string) => new TextEncoder().encode(s);
    const embeddedFiles = () =>
      new Map<string, Uint8Array>([
        ["/index.html", enc(SHELL)],
        ["/app.js", enc(JS)],
        ["/app.css", enc(CSS)],
        ["/assets/icon-abc123.png", PNG],
      ]);

    it("serves embedded /app.js with the right Content-Type and no-store", async () => {
      const app = createApp({ db, registry, cwd, embeddedFiles: embeddedFiles() });
      const res = await app.request("/app.js");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("javascript");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe(JS);
    });

    it("serves embedded /app.css with the right Content-Type and no-store", async () => {
      const app = createApp({ db, registry, cwd, embeddedFiles: embeddedFiles() });
      const res = await app.request("/app.css");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("css");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe(CSS);
    });

    it("serves the embedded shell for the root path with no-store", async () => {
      const app = createApp({ db, registry, cwd, embeddedFiles: embeddedFiles() });
      const res = await app.request("/");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe(SHELL);
    });

    it("serves the embedded shell for client-side routes so refresh boots the app", async () => {
      const app = createApp({ db, registry, cwd, embeddedFiles: embeddedFiles() });
      const res = await app.request("/runs/abc-123");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(await res.text()).toBe(SHELL);
    });

    it("does not intercept unknown /api/* paths even when embedded is active", async () => {
      const app = createApp({ db, registry, cwd, embeddedFiles: embeddedFiles() });
      const res = await app.request("/api/nope");
      expect(res.status).toBe(404);
    });

    it("serves hashed /assets/* with image content-type and an immutable cache", async () => {
      const app = createApp({ db, registry, cwd, embeddedFiles: embeddedFiles() });
      const res = await app.request("/assets/icon-abc123.png");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toContain("immutable");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    });

    it("uses disk over embedded when both are supplied (explicit override wins)", async () => {
      const root = join(cwd, "disk-shell");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "index.html"), "<html>from-disk</html>");
      const app = createApp({
        db,
        registry,
        cwd,
        staticRoot: root,
        embeddedFiles: embeddedFiles(),
      });

      const res = await app.request("/runs/abc-123");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<html>from-disk</html>");
    });
  });

  describe("global error handling", () => {
    it("returns JSON 404 honouring the { error } contract for unmatched /api/* routes", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/does-not-exist");
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: "not found" });
    });

    it("translates HTTPException thrown from a handler into its status and message", async () => {
      const app = createApp({ db, registry, cwd });
      app.get("/api/teapot", () => {
        throw new HTTPException(418, { message: "i am a teapot" });
      });
      const res = await app.request("/api/teapot");
      expect(res.status).toBe(418);
      expect(await res.json()).toEqual({ error: "i am a teapot" });
    });

    it("returns an opaque JSON 500 for uncaught throws and logs the cause", async () => {
      const app = createApp({ db, registry, cwd });
      app.get("/api/boom", () => {
        throw new Error("secret internal detail");
      });

      const errors: unknown[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };

      let res: Response;
      try {
        res = await app.request("/api/boom");
      } finally {
        console.error = originalError;
      }

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body).toEqual({ error: "internal server error" });
      expect(body.error).not.toContain("secret internal detail");
      expect(
        errors.some((args) =>
          (args as unknown[]).some(
            (a) => a instanceof Error && a.message === "secret internal detail",
          ),
        ),
      ).toBe(true);
    });
  });
});
