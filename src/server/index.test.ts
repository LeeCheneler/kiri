import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { bootstrap } from "./bootstrap.ts";
import type { KiriDb } from "./db/index.ts";
import { runs } from "./db/schema.ts";
import { createApp } from "./index.ts";
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

  describe("GET /api/health", () => {
    it("returns ok", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });
  });

  describe("GET /api/workflows", () => {
    it("returns an empty array when the registry is empty", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("summarizes registry entries with name, steps, gating, and schedule", async () => {
      const wf: WorkflowDefinition = {
        name: "demo",
        steps: [{ use: "demo" }],
        gating: "auto",
        schedule: "*/5 * * * *",
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]).toEqual({
        name: "demo",
        steps: [{ use: "demo" }],
        gating: "auto",
        schedule: "*/5 * * * *",
      });
    });
  });

  const CLIENT_HEADERS = { "X-Kiri-Client": "kiri-ui" };

  describe("POST /api/workflows/:name/runs", () => {
    it("returns 404 for an unknown workflow name", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows/nope/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'workflow "nope" not found' });
    });

    it("triggers a run and returns runId + status", async () => {
      writeBundle("hi", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = {
        name: "greeter",
        steps: [{ use: "hi" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows/greeter/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { runId: string; status: string };
      expect(body.status).toBe("ok");
      expect(body.runId).toMatch(/[0-9a-f-]{36}/);

      const run = db.select().from(runs).where(eq(runs.id, body.runId)).get();
      expect(run?.workflowName).toBe("greeter");
      expect(run?.trigger).toBe("manual");
      expect(run?.status).toBe("ok");
    });
  });

  describe("GET /api/runs", () => {
    const triggerRun = async (app: ReturnType<typeof createApp>, name: string) => {
      const res = await app.request(`/api/workflows/${name}/runs`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await res.json()) as { runId: string };
      return runId;
    };

    it("returns runs newest-first with isOrphan derived from the registry", async () => {
      writeBundle("a", "#!/bin/sh\necho a\n");
      writeBundle("b", "#!/bin/sh\necho b\n");
      const wfA: WorkflowDefinition = {
        name: "alpha",
        steps: [{ use: "a" }],
      };
      const wfB: WorkflowDefinition = {
        name: "beta",
        steps: [{ use: "b" }],
      };
      registry.replace(
        new Map([
          [wfA.name, wfA],
          [wfB.name, wfB],
        ]),
      );

      const app = createApp({ db, registry, cwd });
      const firstId = await triggerRun(app, "alpha");
      const secondId = await triggerRun(app, "beta");

      // Drop alpha from the registry — its prior run is now an orphan.
      registry.replace(new Map([[wfB.name, wfB]]));

      const res = await app.request("/api/runs");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        id: string;
        workflowName: string;
        isOrphan: boolean;
      }>;
      expect(body.map((r) => r.id)).toEqual([secondId, firstId]);
      expect(body[0]).toMatchObject({ workflowName: "beta", isOrphan: false });
      expect(body[1]).toMatchObject({ workflowName: "alpha", isOrphan: true });
    });

    it("honours limit and offset", async () => {
      writeBundle("n", "#!/bin/sh\necho n\n");
      const wf: WorkflowDefinition = {
        name: "wf",
        steps: [{ use: "n" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push(await triggerRun(app, "wf"));

      const limited = (await (await app.request("/api/runs?limit=2")).json()) as Array<{
        id: string;
      }>;
      expect(limited).toHaveLength(2);
      expect(limited.map((r) => r.id)).toEqual([ids[2], ids[1]]);

      const offset = (await (await app.request("/api/runs?limit=2&offset=1")).json()) as Array<{
        id: string;
      }>;
      expect(offset.map((r) => r.id)).toEqual([ids[1], ids[0]]);
    });
  });

  describe("GET /api/runs/:id", () => {
    it("returns 404 for an unknown run id", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs/missing");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'run "missing" not found' });
    });

    it("returns the run with steps ordered by index", async () => {
      writeBundle("one", "#!/bin/sh\necho one\n");
      const wf: WorkflowDefinition = {
        name: "two-step",
        steps: [{ use: "one" }, { sh: "cat" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const trigger = await app.request("/api/workflows/two-step/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: { id: string; workflowName: string; isOrphan: boolean };
        steps: Array<{
          index: number;
          kind: string;
          output: unknown;
          materials: Record<string, unknown>;
        }>;
      };
      expect(body.run).toMatchObject({ id: runId, workflowName: "two-step", isOrphan: false });
      expect(body.steps.map((n) => n.index)).toEqual([0, 1]);
      expect(body.steps[0].output).toBe("one\n");
      expect(body.steps[0].kind).toBe("use");
      expect(body.steps[0].materials).toEqual({
        kind: "use",
        bundle: "one",
        files: { "run.sh": "#!/bin/sh\necho one\n" },
      });
      expect(body.steps[1].kind).toBe("sh");
      expect(body.steps[1].materials).toEqual({ kind: "sh", source: "cat" });
    });

    it("flags isOrphan when the workflow no longer exists", async () => {
      writeBundle("x", "#!/bin/sh\necho x\n");
      const wf: WorkflowDefinition = {
        name: "ephemeral",
        steps: [{ use: "x" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const trigger = await app.request("/api/workflows/ephemeral/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };

      registry.replace(new Map());

      const res = await app.request(`/api/runs/${runId}`);
      const body = (await res.json()) as { run: { isOrphan: boolean } };
      expect(body.run.isOrphan).toBe(true);
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

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows/kept/runs", {
        method: "POST",
        headers: { "X-Kiri-Client": "anything" },
      });
      expect(res.status).toBe(200);
    });

    it("does not require the header on safe (GET) requests", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs");
      expect(res.status).toBe(200);
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
});
