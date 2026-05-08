import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

  const writeScript = (relPath: string, body: string): string => {
    const abs = join(cwd, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    chmodSync(abs, 0o755);
    return abs;
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

    it("summarizes registry entries with name, nodes, gating, and schedule", async () => {
      const wf: WorkflowDefinition = {
        name: "demo",
        nodes: [{ kind: "script", path: "scripts/n.sh" }],
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
        nodes: [{ kind: "script", path: "scripts/n.sh" }],
        gating: "auto",
        schedule: "*/5 * * * *",
      });
    });
  });

  describe("POST /api/workflows/:name/runs", () => {
    it("returns 404 for an unknown workflow name", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows/nope/runs", { method: "POST" });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'workflow "nope" not found' });
    });

    it("triggers a run and returns runId + status", async () => {
      writeScript("scripts/hi.sh", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = {
        name: "greeter",
        nodes: [{ kind: "script", path: "scripts/hi.sh" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows/greeter/runs", { method: "POST" });
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
      const res = await app.request(`/api/workflows/${name}/runs`, { method: "POST" });
      const { runId } = (await res.json()) as { runId: string };
      return runId;
    };

    it("returns runs newest-first with isOrphan derived from the registry", async () => {
      writeScript("scripts/a.sh", "#!/bin/sh\necho a\n");
      writeScript("scripts/b.sh", "#!/bin/sh\necho b\n");
      const wfA: WorkflowDefinition = {
        name: "alpha",
        nodes: [{ kind: "script", path: "scripts/a.sh" }],
      };
      const wfB: WorkflowDefinition = {
        name: "beta",
        nodes: [{ kind: "script", path: "scripts/b.sh" }],
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
      writeScript("scripts/n.sh", "#!/bin/sh\necho n\n");
      const wf: WorkflowDefinition = {
        name: "wf",
        nodes: [{ kind: "script", path: "scripts/n.sh" }],
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

    it("returns the run with nodes ordered by index", async () => {
      writeScript("scripts/one.sh", "#!/bin/sh\necho one\n");
      writeScript("scripts/two.sh", "#!/bin/sh\ncat\n");
      const wf: WorkflowDefinition = {
        name: "two-step",
        nodes: [
          { kind: "script", path: "scripts/one.sh" },
          { kind: "script", path: "scripts/two.sh" },
        ],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const trigger = await app.request("/api/workflows/two-step/runs", { method: "POST" });
      const { runId } = (await trigger.json()) as { runId: string };

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: { id: string; workflowName: string; isOrphan: boolean };
        nodes: Array<{ index: number; output: unknown; materials: { source: string } }>;
      };
      expect(body.run).toMatchObject({ id: runId, workflowName: "two-step", isOrphan: false });
      expect(body.nodes.map((n) => n.index)).toEqual([0, 1]);
      expect(body.nodes[0].output).toBe("one\n");
      expect(body.nodes[0].materials.source).toBe("#!/bin/sh\necho one\n");
    });

    it("flags isOrphan when the workflow no longer exists", async () => {
      writeScript("scripts/x.sh", "#!/bin/sh\necho x\n");
      const wf: WorkflowDefinition = {
        name: "ephemeral",
        nodes: [{ kind: "script", path: "scripts/x.sh" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const trigger = await app.request("/api/workflows/ephemeral/runs", { method: "POST" });
      const { runId } = (await trigger.json()) as { runId: string };

      registry.replace(new Map());

      const res = await app.request(`/api/runs/${runId}`);
      const body = (await res.json()) as { run: { isOrphan: boolean } };
      expect(body.run.isOrphan).toBe(true);
    });
  });
});
