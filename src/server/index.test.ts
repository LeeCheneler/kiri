import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bootstrap } from "./bootstrap.ts";
import type { KiriDb } from "./db/index.ts";
import { runs } from "./db/schema.ts";
import { createApp } from "./index.ts";
import { type Registry, createRegistry, defineWorkflow } from "./workflows/index.ts";

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

    it("summarizes registry entries with name, nodes, gating, schedule, and inputSchema", async () => {
      const wf = defineWorkflow({
        name: "demo",
        inputSchema: z.object({ topic: z.string() }),
        nodes: [{ kind: "script", path: "scripts/n.sh" }],
        gating: "auto",
        schedule: "*/5 * * * *",
      });
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        name: "demo",
        nodes: [{ kind: "script", path: "scripts/n.sh" }],
        gating: "auto",
        schedule: "*/5 * * * *",
      });
      // z.toJSONSchema renders the input schema; assert its presence and
      // that it carries the declared property, not the exact JSON shape.
      const inputSchema = body[0].inputSchema as { properties?: Record<string, unknown> };
      expect(inputSchema.properties).toHaveProperty("topic");
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
      const wf = defineWorkflow({
        name: "greeter",
        inputSchema: z.object({}),
        nodes: [{ kind: "script", path: "scripts/hi.sh" }],
      });
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
});
