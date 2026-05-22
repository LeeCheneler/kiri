import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
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

  describe("GET /api/health", () => {
    it("returns ok", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });
  });

  describe("GET /api/version", () => {
    it("returns the version passed to createApp", async () => {
      const app = createApp({ db, registry, cwd, version: "v9.9.9" });
      const res = await app.request("/api/version");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ version: "v9.9.9" });
    });

    it('defaults to "dev" when version is not provided', async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/version");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ version: "dev" });
    });
  });

  describe("GET /api/workflows", () => {
    it("returns an empty array when the registry is empty", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("summarizes registry entries with name, steps, and gating", async () => {
      const wf: WorkflowDefinition = {
        name: "demo",
        steps: [{ use: "demo" }],
        gating: "auto",
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
      });
    });

    it("omits publish and summarize when the workflow has neither", async () => {
      const wf: WorkflowDefinition = { name: "steps-only", steps: [{ sh: "echo hi" }] };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows");
      const body = (await res.json()) as Array<Record<string, unknown>>;
      // Absence is signalled by missing keys (JSON.stringify drops `undefined`),
      // never by `[]` or `null`. Callers branch on "field present" with no
      // empty-collection ambiguity.
      expect("publish" in body[0]).toBe(false);
      expect("summarize" in body[0]).toBe(false);
    });

    it("projects publish entries with title resolved from the schema fallback", async () => {
      const wf: WorkflowDefinition = {
        name: "publishes",
        steps: [{ sh: "echo hi" }],
        publish: [
          { name: "pr-digest", use: "claude-code", env: { MODEL: "sonnet" } },
          { name: "report", title: "Weekly Report", sh: "echo report" },
        ],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows");
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(body[0].publish).toEqual([
        { name: "pr-digest", title: "PR Digest", use: "claude-code", env: { MODEL: "sonnet" } },
        { name: "report", title: "Weekly Report", sh: "echo report" },
      ]);
      expect("summarize" in body[0]).toBe(false);
    });

    it("projects summarize as-is when only summarize is defined", async () => {
      const wf: WorkflowDefinition = {
        name: "summarises",
        steps: [{ sh: "echo hi" }],
        summarize: { use: "claude-code-summarizer", env: { MODEL: "haiku" } },
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows");
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(body[0].summarize).toEqual({
        use: "claude-code-summarizer",
        env: { MODEL: "haiku" },
      });
      expect("publish" in body[0]).toBe(false);
    });

    it("projects both publish and summarize when the workflow has both", async () => {
      const wf: WorkflowDefinition = {
        name: "full",
        steps: [{ sh: "echo hi" }],
        publish: [{ name: "digest", sh: "echo body" }],
        summarize: { sh: "echo one-liner" },
      };
      registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/workflows");
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(body[0].publish).toEqual([{ name: "digest", title: "Digest", sh: "echo body" }]);
      expect(body[0].summarize).toEqual({ sh: "echo one-liner" });
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

    type RunsPageBody = {
      runs: Array<{ id: string; workflowName: string; isInterrupted: boolean; status: string }>;
      nextCursor: string | null;
    };

    it("returns the first page newest-first with isInterrupted derived from the registry", async () => {
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
      const body = (await res.json()) as RunsPageBody;
      expect(body.runs.map((r) => r.id)).toEqual([secondId, firstId]);
      expect(body.runs[0]).toMatchObject({ workflowName: "beta", isInterrupted: false });
      expect(body.runs[1]).toMatchObject({ workflowName: "alpha", isInterrupted: true });
      // Default page size is 25; we returned 2 rows so there's nothing further.
      expect(body.nextCursor).toBeNull();
    });

    it("pages forward via the cursor and returns nextCursor on a full page", async () => {
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

      // First page (limit=2) returns the two newest runs and a cursor pointing
      // at the oldest of those two.
      const page1 = (await (await app.request("/api/runs?limit=2")).json()) as RunsPageBody;
      expect(page1.runs.map((r) => r.id)).toEqual([ids[2], ids[1]]);
      expect(page1.nextCursor).toBe(ids[1]);

      // Page two via the cursor: the remaining oldest run, no further pages.
      const page2 = (await (
        await app.request(`/api/runs?limit=2&cursor=${page1.nextCursor}`)
      ).json()) as RunsPageBody;
      expect(page2.runs.map((r) => r.id)).toEqual([ids[0]]);
      expect(page2.nextCursor).toBeNull();
    });

    it("returns an empty page with null nextCursor when the cursor sits past the end", async () => {
      writeBundle("n", "#!/bin/sh\necho n\n");
      const wf: WorkflowDefinition = { name: "wf", steps: [{ use: "n" }] };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const onlyId = await triggerAndAwait(app, "wf", waitForFinished);

      const past = (await (await app.request(`/api/runs?cursor=${onlyId}`)).json()) as RunsPageBody;
      expect(past.runs).toEqual([]);
      expect(past.nextCursor).toBeNull();
    });

    it("rejects an out-of-range limit with 400", async () => {
      const app = createApp({ db, registry, cwd });

      const tooSmall = await app.request("/api/runs?limit=0");
      expect(tooSmall.status).toBe(400);

      const tooBig = await app.request("/api/runs?limit=101");
      expect(tooBig.status).toBe(400);

      const nan = await app.request("/api/runs?limit=banana");
      expect(nan.status).toBe(400);
    });

    it("rejects an unknown cursor with 400", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs?cursor=does-not-exist");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'cursor "does-not-exist" not found' });
    });

    it("attaches each run's articles to its row in a single aggregation across the page", async () => {
      writeBundle("step", "#!/bin/sh\necho s\n");
      writeBundle("digest", "#!/bin/sh\necho digest-body\n");
      writeBundle("notes", "#!/bin/sh\necho notes-body\n");
      const noPub: WorkflowDefinition = { name: "no-pub", steps: [{ use: "step" }] };
      const onePub: WorkflowDefinition = {
        name: "one-pub",
        steps: [{ use: "step" }],
        publish: [{ name: "digest", title: "Digest Title", use: "digest" }],
      };
      const twoPub: WorkflowDefinition = {
        name: "two-pub",
        steps: [{ use: "step" }],
        publish: [
          { name: "digest", use: "digest" },
          { name: "release-notes", use: "notes" },
        ],
      };
      registry.replace(
        new Map([
          [noPub.name, noPub],
          [onePub.name, onePub],
          [twoPub.name, twoPub],
        ]),
      );

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const triggerAndAwait = async (name: string) => {
        const res = await app.request(`/api/workflows/${name}/runs`, {
          method: "POST",
          headers: CLIENT_HEADERS,
        });
        const { runId } = (await res.json()) as { runId: string };
        await waitForFinished(runId);
        return runId;
      };
      const noPubId = await triggerAndAwait("no-pub");
      const onePubId = await triggerAndAwait("one-pub");
      const twoPubId = await triggerAndAwait("two-pub");

      const res = await app.request("/api/runs");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        runs: Array<{
          id: string;
          articles: Array<{ name: string; title: string; createdAt: string }>;
        }>;
      };
      const byId = new Map(body.runs.map((r) => [r.id, r]));
      expect(byId.get(noPubId)?.articles).toEqual([]);
      expect(byId.get(onePubId)?.articles.map((a) => a.name)).toEqual(["digest"]);
      expect(byId.get(onePubId)?.articles[0]).toMatchObject({
        name: "digest",
        title: "Digest Title",
      });
      // Declared order matches created_at order (publishes run serially).
      expect(byId.get(twoPubId)?.articles.map((a) => a.name)).toEqual(["digest", "release-notes"]);
      // ISO timestamp round-trip via Date.toJSON.
      for (const r of body.runs) {
        for (const a of r.articles) expect(a.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it("scopes articles to the page — cursor pages don't leak the previous page's articles", async () => {
      writeBundle("step", "#!/bin/sh\necho s\n");
      writeBundle("digest", "#!/bin/sh\necho digest-body\n");
      const wfA: WorkflowDefinition = {
        name: "wf-a",
        steps: [{ use: "step" }],
        publish: [{ name: "digest-a", use: "digest" }],
      };
      const wfB: WorkflowDefinition = {
        name: "wf-b",
        steps: [{ use: "step" }],
        publish: [{ name: "digest-b", use: "digest" }],
      };
      registry.replace(
        new Map([
          [wfA.name, wfA],
          [wfB.name, wfB],
        ]),
      );

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const triggerAndAwait = async (name: string) => {
        const res = await app.request(`/api/workflows/${name}/runs`, {
          method: "POST",
          headers: CLIENT_HEADERS,
        });
        const { runId } = (await res.json()) as { runId: string };
        await waitForFinished(runId);
        return runId;
      };
      const oldRunId = await triggerAndAwait("wf-a");
      const newRunId = await triggerAndAwait("wf-b");

      type RunsBody = {
        runs: Array<{ id: string; articles: Array<{ name: string }> }>;
        nextCursor: string | null;
      };
      const page1 = (await (await app.request("/api/runs?limit=1")).json()) as RunsBody;
      expect(page1.runs.map((r) => r.id)).toEqual([newRunId]);
      expect(page1.runs[0]?.articles.map((a) => a.name)).toEqual(["digest-b"]);

      const page2 = (await (
        await app.request(`/api/runs?limit=1&cursor=${page1.nextCursor}`)
      ).json()) as RunsBody;
      expect(page2.runs.map((r) => r.id)).toEqual([oldRunId]);
      // Page 2 only carries page 2's articles; page 1's digest-b doesn't leak.
      expect(page2.runs[0]?.articles.map((a) => a.name)).toEqual(["digest-a"]);
    });

    it("returns each run with an empty articles array when none of the page's runs have published", async () => {
      writeBundle("step", "#!/bin/sh\necho s\n");
      const wf: WorkflowDefinition = { name: "plain", steps: [{ use: "step" }] };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const res = await app.request("/api/workflows/plain/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await res.json()) as { runId: string };
      await waitForFinished(runId);

      const body = (await (await app.request("/api/runs")).json()) as {
        runs: Array<{ id: string; articles: unknown[] }>;
      };
      expect(body.runs).toHaveLength(1);
      expect(body.runs[0]?.articles).toEqual([]);
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
        }>;
      };
      expect(body.run).toMatchObject({ id: runId, workflowName: "two-step", isInterrupted: false });
      expect(body.steps.map((n) => n.index)).toEqual([0, 1]);
      expect(body.steps[0].output).toBe("one\n");
      expect(body.steps[0].kind).toBe("use");
      expect(body.steps[1].kind).toBe("sh");
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

    it("returns an empty articles array and unchanged step list when the run has no publishes", async () => {
      writeBundle("one", "#!/bin/sh\necho one\n");
      const wf: WorkflowDefinition = {
        name: "plain",
        steps: [{ use: "one" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const trigger = await app.request("/api/workflows/plain/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: { articles: unknown[] };
        steps: Array<{ index: number }>;
      };
      expect(body.run.articles).toEqual([]);
      expect(body.steps.map((s) => s.index)).toEqual([0]);
    });

    it("returns articles ordered by created_at on run.articles and includes publish rows tagged isPublish in the step list", async () => {
      writeBundle("one", "#!/bin/sh\necho one\n");
      writeBundle("digest", "#!/bin/sh\necho digest-body\n");
      writeBundle("notes", "#!/bin/sh\necho notes-body\n");
      const wf: WorkflowDefinition = {
        name: "with-publish",
        steps: [{ use: "one" }],
        publish: [
          { name: "digest", title: "Digest Title", use: "digest" },
          { name: "release-notes", use: "notes" },
        ],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const trigger = await app.request("/api/workflows/with-publish/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: { articles: Array<{ name: string; title: string; createdAt: string }> };
        steps: Array<{ index: number; kind: string; isPublish: boolean; isSummary: boolean }>;
      };
      // Pipeline step plus both publish rows in declared/index order; the
      // client separates them by isPublish (same pattern as isSummary).
      expect(body.steps.map((s) => [s.index, s.isPublish, s.isSummary])).toEqual([
        [0, false, false],
        [1, true, false],
        [2, true, false],
      ]);
      // Declared order matches created_at order (publishes run serially).
      const articleRows = body.run.articles;
      expect(articleRows.map((a) => a.name)).toEqual(["digest", "release-notes"]);
      // Resolved title travels with each row; defaulted via titlecase when omitted.
      expect(articleRows[0]).toMatchObject({ name: "digest", title: "Digest Title" });
      expect(articleRows[1]).toMatchObject({ name: "release-notes", title: "Release Notes" });
      // content_md is intentionally absent on this payload.
      for (const a of articleRows) expect(a).not.toHaveProperty("contentMd");
      // createdAt round-trips as an ISO timestamp (Date.toJSON in the response).
      for (const a of articleRows) expect(a.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("exposes a failed publish row alongside the ok sibling's article", async () => {
      writeBundle("one", "#!/bin/sh\necho one\n");
      writeBundle("bad", "#!/bin/sh\nexit 2\n");
      writeBundle("good", "#!/bin/sh\necho good-body\n");
      const wf: WorkflowDefinition = {
        name: "pub-fail",
        steps: [{ use: "one" }],
        publish: [
          { name: "bad", use: "bad" },
          { name: "good", use: "good" },
        ],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const trigger = await app.request("/api/workflows/pub-fail/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: { articles: Array<{ name: string }> };
        steps: Array<{ index: number; status: string; isPublish: boolean }>;
      };
      // Pipeline step, failed publish, ok publish — all three rows ship.
      expect(body.steps.map((s) => [s.index, s.status, s.isPublish])).toEqual([
        [0, "ok", false],
        [1, "failed", true],
        [2, "ok", true],
      ]);
      // The failed publish produced no article row; the ok sibling did.
      expect(body.run.articles.map((a) => a.name)).toEqual(["good"]);
    });

    it("surfaces a running publish row before its article has been written", async () => {
      writeBundle("one", "#!/bin/sh\necho one\n");
      // Long-running publish so we can observe the in-flight row mid-execution.
      // `exec 1>&- 2>&-` closes stdio before sleep is forked so cancel readers
      // unblock cleanly when the test tears down (same idiom used elsewhere).
      const wf: WorkflowDefinition = {
        name: "slow-publish",
        steps: [{ use: "one" }],
        publish: [{ name: "slow", sh: "exec 1>&- 2>&-; sleep 5" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const bus = createEventBus();
      // Resolve when the publish step's `run.step.updated` event with the
      // running status lands — guarantees the row exists and is in flight.
      const publishRunning = new Promise<string>((resolve) => {
        bus.subscribe((e) => {
          if (e.type === "run.step.updated" && e.step === 1 && e.status === "running") {
            resolve(e.runId);
          }
        });
      });
      const app = createApp({ db, registry, cwd, bus, cancelRegistry });

      const trigger = await app.request("/api/workflows/slow-publish/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await publishRunning;

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: { articles: Array<{ name: string }> };
        steps: Array<{ index: number; status: string; isPublish: boolean }>;
      };
      // The publish row exists in `steps[]` tagged isPublish=true, status=running.
      const publishRow = body.steps.find((s) => s.isPublish);
      expect(publishRow).toMatchObject({ index: 1, status: "running", isPublish: true });
      // Article row isn't written until the publish exits ok, so the array
      // stays empty while the publish is in flight.
      expect(body.run.articles).toEqual([]);

      // Tear down the in-flight publish so afterEach doesn't close the DB
      // mid-write. Cancel and wait for the row to flip terminal.
      const finished = new Promise<void>((resolve) => {
        bus.subscribe((e) => {
          if (e.type === "run.finished" && e.id === runId) resolve();
        });
      });
      cancelRegistry.requestCancel(runId);
      await finished;
    });
  });

  describe("GET /api/runs/:id/published/:name", () => {
    const setupPublishingRun = async () => {
      writeBundle("one", "#!/bin/sh\necho one\n");
      writeBundle("digest", "#!/bin/sh\nprintf '# Heading\\n\\nBody paragraph.\\n'\n");
      const wf: WorkflowDefinition = {
        name: "with-publish",
        steps: [{ use: "one" }],
        publish: [{ name: "digest", title: "Digest Title", use: "digest" }],
      };
      registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const trigger = await app.request("/api/workflows/with-publish/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);
      return { app, runId };
    };

    it("returns the article body and metadata on the happy path", async () => {
      const { app, runId } = await setupPublishingRun();

      const res = await app.request(`/api/runs/${runId}/published/digest`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: string;
        runId: string;
        name: string;
        title: string;
        contentMd: string;
        createdAt: string;
        workflowName: string;
      };
      expect(body.runId).toBe(runId);
      expect(body.name).toBe("digest");
      expect(body.title).toBe("Digest Title");
      expect(body.workflowName).toBe("with-publish");
      expect(body.contentMd).toContain("# Heading");
      expect(body.contentMd).toContain("Body paragraph.");
      expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.id).toMatch(/[0-9a-f-]{36}/);
    });

    it("returns 404 when the run id is unknown", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs/missing-run/published/digest");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'run "missing-run" not found' });
    });

    it("returns 404 when the article name is unknown on an existing run", async () => {
      const { app, runId } = await setupPublishingRun();
      const res = await app.request(`/api/runs/${runId}/published/nope`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: `article "nope" not found on run "${runId}"`,
      });
    });

    it("returns 400 when the article name fails the schema regex", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs/any-id/published/Bad_Name");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/publish name must match/);
    });
  });

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

  describe("DELETE /api/runs/:id", () => {
    // Seed a finished run plus a step and an article row so each delete
    // test exercises the full cascade rather than just the parent row.
    const seedTerminalRun = (id: string, opts: { status?: "ok" | "failed" | "cancelled" } = {}) => {
      db.insert(runs)
        .values({
          id,
          workflowName: "demo",
          status: opts.status ?? "ok",
          trigger: "manual",
          startedAt: new Date(),
          finishedAt: new Date(),
          definitionSnapshot: { name: "demo", steps: [{ sh: "echo hi" }] },
        })
        .run();
      db.insert(runSteps)
        .values({
          id: `${id}-step-0`,
          runId: id,
          index: 0,
          kind: "sh",
          status: "ok",
          output: null,
          error: null,
          traces: { stdout: "hi\n", stderr: "", durationMs: 1 },
        })
        .run();
      db.insert(articles)
        .values({
          id: `${id}-art`,
          runId: id,
          name: "digest",
          title: "Digest",
          contentMd: "# hi",
          createdAt: new Date(),
        })
        .run();
    };

    it("returns 404 for an unknown run id", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs/missing", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'run "missing" not found' });
    });

    it("returns 409 when the run is still running", async () => {
      const id = "still-running";
      db.insert(runs)
        .values({
          id,
          workflowName: "demo",
          status: "running",
          trigger: "manual",
          startedAt: new Date(),
          definitionSnapshot: { name: "demo", steps: [] },
        })
        .run();

      const app = createApp({ db, registry, cwd });
      const res = await app.request(`/api/runs/${id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: `run "${id}" is in flight; cancel it first` });

      // Nothing was deleted — caller must cancel first.
      expect(db.select().from(runs).where(eq(runs.id, id)).get()).toBeDefined();
    });

    it("rejects DELETE without the X-Kiri-Client header (CSRF gate)", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs/anything", { method: "DELETE" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "X-Kiri-Client header required" });
    });

    it("removes the run, its steps, its articles, and the scratch dir; publishes run.deleted", async () => {
      const id = "to-delete";
      seedTerminalRun(id);
      // Simulate a scratch-dir leftover (e.g. crashed runner). A normal
      // finished run has no scratch dir, so we create one explicitly to
      // exercise the cleanup branch.
      const scratch = join(cwd, ".kiri", "runs", id);
      mkdirSync(scratch, { recursive: true });
      writeFileSync(join(scratch, "leftover.txt"), "crash residue");

      const bus = createEventBus();
      const seen: KiriEvent[] = [];
      bus.subscribe((e) => seen.push(e));

      const app = createApp({ db, registry, cwd, bus });
      const res = await app.request(`/api/runs/${id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");

      expect(db.select().from(runs).where(eq(runs.id, id)).get()).toBeUndefined();
      expect(db.select().from(runSteps).where(eq(runSteps.runId, id)).all()).toEqual([]);
      expect(db.select().from(articles).where(eq(articles.runId, id)).all()).toEqual([]);
      expect(existsSync(scratch)).toBe(false);
      expect(seen).toContainEqual({ type: "run.deleted", id });
    });

    it("returns 204 even with no scratch dir on disk (idempotent cleanup)", async () => {
      const id = "no-scratch";
      seedTerminalRun(id);

      const app = createApp({ db, registry, cwd });
      const res = await app.request(`/api/runs/${id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(204);
      expect(db.select().from(runs).where(eq(runs.id, id)).get()).toBeUndefined();
    });

    it("returns 404 on a double-delete (the run is gone after the first)", async () => {
      const id = "twice";
      seedTerminalRun(id);

      const app = createApp({ db, registry, cwd });
      const first = await app.request(`/api/runs/${id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(first.status).toBe(204);

      const second = await app.request(`/api/runs/${id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(second.status).toBe(404);
      expect(await second.json()).toEqual({ error: `run "${id}" not found` });
    });
  });

  describe("POST /api/runs/:id/rerun", () => {
    const seedTerminalRun = (
      id: string,
      opts: {
        workflowName?: string;
        status?: "ok" | "failed" | "cancelled";
        trigger?: string;
      } = {},
    ) => {
      const workflowName = opts.workflowName ?? "demo";
      db.insert(runs)
        .values({
          id,
          workflowName,
          status: opts.status ?? "failed",
          trigger: opts.trigger ?? "manual",
          startedAt: new Date(),
          finishedAt: new Date(),
          error: { message: "first attempt failed" },
          definitionSnapshot: { name: workflowName, steps: [{ sh: "echo old" }] },
        })
        .run();
      db.insert(runSteps)
        .values({
          id: `${id}-step-0`,
          runId: id,
          index: 0,
          kind: "sh",
          status: "failed",
          output: null,
          error: { message: "first attempt failed" },
          traces: { stdout: "", stderr: "boom", durationMs: 1 },
        })
        .run();
      db.insert(articles)
        .values({
          id: `${id}-art`,
          runId: id,
          name: "leftover",
          title: "Leftover",
          contentMd: "stale",
          createdAt: new Date(),
        })
        .run();
    };

    it("returns 404 for an unknown run id", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs/missing/rerun", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'run "missing" not found' });
    });

    it("returns 409 when the run is still running", async () => {
      const id = "still-running";
      db.insert(runs)
        .values({
          id,
          workflowName: "demo",
          status: "running",
          trigger: "manual",
          startedAt: new Date(),
          definitionSnapshot: { name: "demo", steps: [] },
        })
        .run();

      const app = createApp({ db, registry, cwd });
      const res = await app.request(`/api/runs/${id}/rerun`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: `run "${id}" is in flight; cancel it first` });
    });

    it("returns 409 when the source workflow no longer exists in the registry", async () => {
      const id = "interrupted";
      seedTerminalRun(id, { workflowName: "gone" });

      const app = createApp({ db, registry, cwd });
      const res = await app.request(`/api/runs/${id}/rerun`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'workflow "gone" no longer exists; re-create it first',
      });

      // Nothing was wiped — the rerun was rejected before the cascade.
      expect(db.select().from(runSteps).where(eq(runSteps.runId, id)).all()).toHaveLength(1);
      expect(db.select().from(articles).where(eq(articles.runId, id)).all()).toHaveLength(1);
    });

    it("rejects POST without the X-Kiri-Client header (CSRF gate)", async () => {
      const app = createApp({ db, registry, cwd });
      const res = await app.request("/api/runs/anything/rerun", { method: "POST" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "X-Kiri-Client header required" });
    });

    it("logs and absorbs rejections from the background runner so they never go unhandled", async () => {
      const id = "rerun-crash";
      writeBundle("hi", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = { name: "demo", steps: [{ use: "hi" }] };
      registry.replace(new Map([[wf.name, wf]]));
      seedTerminalRun(id);

      // Drop a cancel registry whose isCancelled throws, so the runner's
      // pre-step check inside `done` throws and the route's `done.catch`
      // fires. The runner still finalises the row (try/catch in the IIFE)
      // before re-throwing.
      const throwingRegistry: CancelRegistry = {
        register() {},
        setChild() {},
        requestCancel() {
          return false;
        },
        release() {},
        isCancelled() {
          throw new Error("cancel-registry boom");
        },
      };

      const errors: unknown[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.join(" "));
      };

      try {
        const { bus, waitForFinished } = setupRunWaiter();
        const app = createApp({ db, registry, cwd, bus, cancelRegistry: throwingRegistry });
        const res = await app.request(`/api/runs/${id}/rerun`, {
          method: "POST",
          headers: CLIENT_HEADERS,
        });
        expect(res.status).toBe(202);
        await waitForFinished(id);
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        console.error = originalError;
      }

      expect(errors.some((line) => String(line).includes("crashed"))).toBe(true);
    });

    it("wipes prior steps + articles + scratch dir and re-runs under the same id", async () => {
      const id = "to-rerun";
      writeBundle("hi", "#!/bin/sh\necho fresh\n");
      const wf: WorkflowDefinition = { name: "demo", steps: [{ use: "hi" }] };
      registry.replace(new Map([[wf.name, wf]]));
      seedTerminalRun(id, { trigger: "scheduled" });

      // Scratch-dir leftover (mimicking a crashed runner). Should be removed
      // before the rerun starts so stale files don't pollute the new run.
      const scratch = join(cwd, ".kiri", "runs", id);
      mkdirSync(scratch, { recursive: true });
      writeFileSync(join(scratch, "leftover.txt"), "crash residue");

      const { bus, waitForFinished } = setupRunWaiter();
      const app = createApp({ db, registry, cwd, bus });
      const res = await app.request(`/api/runs/${id}/rerun`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ runId: id, status: "running" });

      await waitForFinished(id);

      // One row, same id, status flipped to ok, trigger preserved.
      const allRows = db.select().from(runs).where(eq(runs.id, id)).all();
      expect(allRows).toHaveLength(1);
      expect(allRows[0].status).toBe("ok");
      expect(allRows[0].trigger).toBe("scheduled");
      expect(allRows[0].error).toBeNull();
      expect(allRows[0].definitionSnapshot).toMatchObject({
        name: "demo",
        steps: [{ use: "hi" }],
      });

      // Old article gone; old step row replaced by the fresh run's step.
      const steps = db.select().from(runSteps).where(eq(runSteps.runId, id)).all();
      expect(steps).toHaveLength(1);
      expect(steps[0].status).toBe("ok");
      expect(steps[0].output).toBe("fresh\n");
      expect(steps.some((s) => s.id === `${id}-step-0`)).toBe(false);
      expect(db.select().from(articles).where(eq(articles.runId, id)).all()).toEqual([]);

      // Leftover scratch file is gone.
      expect(existsSync(join(scratch, "leftover.txt"))).toBe(false);
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
      const body = (await res.json()) as {
        runs: Array<{ id: string; status: string }>;
        nextCursor: string | null;
      };
      const entry = body.runs.find((r) => r.id === runId);
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
