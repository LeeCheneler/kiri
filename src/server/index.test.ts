import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { bootstrap } from "./bootstrap.ts";
import type { KiriDb } from "./db/index.ts";
import { runs } from "./db/schema.ts";
import { type KiriEvent, createEventBus } from "./events/index.ts";
import { createApp } from "./index.ts";
import { createCancelRegistry } from "./runner/cancel-registry.ts";
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

    it("returns 202 with runId and running status the moment a run starts", async () => {
      writeBundle("hi", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = {
        name: "greeter",
        steps: [{ use: "hi" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const res = await app.request("/api/workflows/greeter/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { runId: string; status: string };
      expect(body.status).toBe("running");
      expect(body.runId).toMatch(/[0-9a-f-]{36}/);

      // Run row exists immediately, still in `running` state.
      const initial = db.select().from(runs).where(eq(runs.id, body.runId)).get();
      expect(initial?.workflowName).toBe("greeter");
      expect(initial?.trigger).toBe("manual");
      expect(initial?.status).toBe("running");
      expect(initial?.finishedAt).toBeNull();

      await waitForFinished(body.runId);

      const finished = db.select().from(runs).where(eq(runs.id, body.runId)).get();
      expect(finished?.status).toBe("ok");
      expect(finished?.finishedAt).toBeInstanceOf(Date);
    });

    it("logs and absorbs rejections from the background runner so they never go unhandled", async () => {
      writeBundle("hi", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = { name: "throwy", steps: [{ use: "hi" }] };
      registry.replace(new Map([[wf.name, wf]]));
      // Pre-create .kiri/runs as a *file* so the runner's mkdirSync(.../runs/<id>)
      // throws ENOTDIR — exercises the route's `done.catch` so the rejection is
      // logged rather than left unhandled.
      writeFileSync(join(cwd, ".kiri", "runs"), "blocker");

      const errors: unknown[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.join(" "));
      };

      try {
        const { bus, waitForFinished } = setupRunWaiter();
        const app = createApp({ db, registry, cwd, bus });
        const res = await app.request("/api/workflows/throwy/runs", {
          method: "POST",
          headers: CLIENT_HEADERS,
        });
        expect(res.status).toBe(202);
        const { runId } = (await res.json()) as { runId: string };
        await waitForFinished(runId);
        // Microtask flush so the .catch handler attached to `done` runs.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        console.error = originalError;
      }

      expect(errors.some((line) => String(line).includes("crashed"))).toBe(true);
    });

    it("forwards the bus into the runner so triggered runs publish lifecycle events", async () => {
      writeBundle("hi", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = {
        name: "greeter",
        steps: [{ use: "hi" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const bus = createEventBus();
      const seen: KiriEvent[] = [];
      const finished = new Promise<void>((resolve) => {
        bus.subscribe((e) => {
          seen.push(e);
          if (e.type === "run.finished") resolve();
        });
      });

      const app = createApp({ db, registry, cwd, bus });
      const res = await app.request("/api/workflows/greeter/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const body = (await res.json()) as { runId: string };
      await finished;

      expect(seen).toContainEqual({ type: "run.started", id: body.runId });
      expect(seen).toContainEqual({
        type: "run.finished",
        id: body.runId,
        status: "ok",
        workflowName: "greeter",
      });
    });
  });

  describe("GET /api/runs", () => {
    const triggerAndAwait = async (
      app: ReturnType<typeof createApp>,
      name: string,
      waitForFinished: (runId: string) => Promise<void>,
    ) => {
      const res = await app.request(`/api/workflows/${name}/runs`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await res.json()) as { runId: string };
      await waitForFinished(runId);
      return runId;
    };

    it("returns runs newest-first with isInterrupted derived from the registry", async () => {
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

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const firstId = await triggerAndAwait(app, "alpha", waitForFinished);
      const secondId = await triggerAndAwait(app, "beta", waitForFinished);

      // Drop alpha from the registry — its prior run is now interrupted.
      registry.replace(new Map([[wfB.name, wfB]]));

      const res = await app.request("/api/runs");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        id: string;
        workflowName: string;
        isInterrupted: boolean;
      }>;
      expect(body.map((r) => r.id)).toEqual([secondId, firstId]);
      expect(body[0]).toMatchObject({ workflowName: "beta", isInterrupted: false });
      expect(body[1]).toMatchObject({ workflowName: "alpha", isInterrupted: true });
    });

    it("honours limit and offset", async () => {
      writeBundle("n", "#!/bin/sh\necho n\n");
      const wf: WorkflowDefinition = {
        name: "wf",
        steps: [{ use: "n" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push(await triggerAndAwait(app, "wf", waitForFinished));

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

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const trigger = await app.request("/api/workflows/two-step/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: { id: string; workflowName: string; isInterrupted: boolean };
        steps: Array<{
          index: number;
          kind: string;
          output: unknown;
          materials: Record<string, unknown>;
        }>;
      };
      expect(body.run).toMatchObject({ id: runId, workflowName: "two-step", isInterrupted: false });
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

    it("flags isInterrupted when the workflow no longer exists", async () => {
      writeBundle("x", "#!/bin/sh\necho x\n");
      const wf: WorkflowDefinition = {
        name: "ephemeral",
        steps: [{ use: "x" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const trigger = await app.request("/api/workflows/ephemeral/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      registry.replace(new Map());

      const res = await app.request(`/api/runs/${runId}`);
      const body = (await res.json()) as { run: { isInterrupted: boolean } };
      expect(body.run.isInterrupted).toBe(true);
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

  describe("POST /api/runs/:id/cancel", () => {
    it("is not mounted when no cancel registry is supplied", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs/anything/cancel", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for an unknown run id", async () => {
      const cancelRegistry = createCancelRegistry();
      const app = createApp({ db, registry, cwd, cancelRegistry });
      const res = await app.request("/api/runs/missing/cancel", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'run "missing" not found' });
    });

    it("returns 409 when the run is already in a terminal state", async () => {
      writeBundle("quick", "#!/bin/sh\necho done\n");
      const wf: WorkflowDefinition = { name: "quick", steps: [{ use: "quick" }] };
      registry.replace(new Map([[wf.name, wf]]));

      const cancelRegistry = createCancelRegistry();
      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus, cancelRegistry });

      const trigger = await app.request("/api/workflows/quick/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      const res = await app.request(`/api/runs/${runId}/cancel`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: `run "${runId}" is not in flight` });
    });

    it("accepts cancel for an in-flight run, returning 202; the run terminates as cancelled", async () => {
      // `exec 1>&- 2>&-` closes sh's stdout/stderr before sleep is forked so
      // Bun's pipe readers get EOF immediately on cancel; otherwise the
      // orphaned sleep holds the write ends and hangs the readers (manifests
      // as a CI-only timeout on Linux).
      const wf: WorkflowDefinition = {
        name: "long",
        steps: [{ sh: "exec 1>&- 2>&-; sleep 5" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus, cancelRegistry });

      const trigger = await app.request("/api/workflows/long/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };

      // Brief settle so the spawn's child is live before we signal it.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const res = await app.request(`/api/runs/${runId}/cancel`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ runId });

      await waitForFinished(runId);
      const final = db.select().from(runs).where(eq(runs.id, runId)).get();
      expect(final?.status).toBe("cancelled");
    });

    it("rejects cancel without the X-Kiri-Client header (CSRF gate)", async () => {
      const cancelRegistry = createCancelRegistry();
      const app = createApp({ db, registry, cwd, cancelRegistry });
      const res = await app.request("/api/runs/anything/cancel", { method: "POST" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "X-Kiri-Client header required" });
    });

    it("returns 409 when the DB row says running but the registry has no entry (closing-window race)", async () => {
      // Pre-seed a `running` row that the registry never registered. Mirrors
      // the brief window where the runner has updated the DB to terminal but
      // hasn't yet released — except in this test the runner isn't involved
      // at all, so requestCancel returns false on this id.
      const interruptedId = "interrupted-running";
      db.insert(runs)
        .values({
          id: interruptedId,
          workflowName: "ghost",
          status: "running",
          trigger: "manual",
          startedAt: new Date(),
          definitionSnapshot: { name: "ghost", steps: [] },
        })
        .run();

      const cancelRegistry = createCancelRegistry();
      const app = createApp({ db, registry, cwd, cancelRegistry });
      const res = await app.request(`/api/runs/${interruptedId}/cancel`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: `run "${interruptedId}" is not in flight` });
    });
  });

  describe("cancelled runs surfaced through the API", () => {
    // `exec 1>&- 2>&-` closes sh's stdout/stderr before sleep is forked so
    // Bun's pipe readers get EOF immediately on cancel; otherwise the
    // orphaned sleep holds the write ends and hangs the readers (manifests
    // as a CI-only timeout on Linux).
    const cancellableWf = (name: string): WorkflowDefinition => ({
      name,
      steps: [{ sh: "exec 1>&- 2>&-; sleep 5" }],
    });

    const triggerAndCancel = async (
      app: ReturnType<typeof createApp>,
      name: string,
      waitForFinished: (runId: string) => Promise<void>,
    ): Promise<string> => {
      const trigger = await app.request(`/api/workflows/${name}/runs`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      // Settle so the spawned child is live before the cancel signal lands.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cancel = await app.request(`/api/runs/${runId}/cancel`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(cancel.status).toBe(202);
      await waitForFinished(runId);
      return runId;
    };

    it("renders a cancelled run on GET /api/runs/:id with cancelled step status and error", async () => {
      const wf = cancellableWf("long");
      registry.replace(new Map([[wf.name, wf]]));
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus, cancelRegistry });

      const runId = await triggerAndCancel(app, "long", waitForFinished);

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: { status: string; error: { message: string } | null };
        steps: Array<{ status: string; error: { message: string } | null }>;
      };
      expect(body.run.status).toBe("cancelled");
      expect(body.run.error).toEqual({ message: "run cancelled" });
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].status).toBe("cancelled");
      expect(body.steps[0].error).toEqual({ message: "run cancelled" });
    });

    it("includes cancelled runs in GET /api/runs with their cancelled status", async () => {
      const wf = cancellableWf("long");
      registry.replace(new Map([[wf.name, wf]]));
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus, cancelRegistry });

      const runId = await triggerAndCancel(app, "long", waitForFinished);

      const res = await app.request("/api/runs");
      const body = (await res.json()) as Array<{ id: string; status: string }>;
      const entry = body.find((r) => r.id === runId);
      expect(entry?.status).toBe("cancelled");
    });

    it("returns 409 on a second cancel after the run has terminated (idempotent fail-stop)", async () => {
      const wf = cancellableWf("long");
      registry.replace(new Map([[wf.name, wf]]));
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus, cancelRegistry });

      const runId = await triggerAndCancel(app, "long", waitForFinished);

      const second = await app.request(`/api/runs/${runId}/cancel`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: `run "${runId}" is not in flight` });
    });

    it("publishes run.finished with status cancelled to the bus when cancelled via HTTP", async () => {
      const wf = cancellableWf("long");
      registry.replace(new Map([[wf.name, wf]]));
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const bus = createEventBus();
      const seen: KiriEvent[] = [];
      const finished = new Promise<void>((resolve) => {
        bus.subscribe((e) => {
          seen.push(e);
          if (e.type === "run.finished") resolve();
        });
      });
      const app = createApp({ db, registry, cwd, bus, cancelRegistry });

      const trigger = await app.request("/api/workflows/long/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await new Promise((resolve) => setTimeout(resolve, 50));
      await app.request(`/api/runs/${runId}/cancel`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });

      await finished;

      expect(seen).toContainEqual({
        type: "run.finished",
        id: runId,
        status: "cancelled",
        workflowName: "long",
      });
      expect(seen).toContainEqual({ type: "run.updated", id: runId, status: "cancelled" });
    });
  });
});
