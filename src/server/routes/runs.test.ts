import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { articles, recommendations, runSteps, runs } from "../db/schema.ts";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import { createApp } from "../index.ts";
import { type CancelRegistry, createCancelRegistry } from "../runner/cancel-registry.ts";
import type { WorkflowDefinition } from "../workflows/index.ts";
import {
  CLIENT_HEADERS,
  type TestEnv,
  createRunWaiter,
  createTestEnv,
  writeBundle,
} from "./test-helpers.ts";

describe("runs routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
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
      writeBundle(env.cwd, "a", "#!/bin/sh\necho a\n");
      writeBundle(env.cwd, "b", "#!/bin/sh\necho b\n");
      const wfA: WorkflowDefinition = { name: "alpha", steps: [{ use: "a" }] };
      const wfB: WorkflowDefinition = { name: "beta", steps: [{ use: "b" }] };
      env.registry.replace(
        new Map([
          [wfA.name, wfA],
          [wfB.name, wfB],
        ]),
      );

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const firstId = await triggerAndAwait(app, "alpha", waitForFinished);
      const secondId = await triggerAndAwait(app, "beta", waitForFinished);

      // Drop alpha from the registry — its prior run is now interrupted.
      env.registry.replace(new Map([[wfB.name, wfB]]));

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
      writeBundle(env.cwd, "n", "#!/bin/sh\necho n\n");
      const wf: WorkflowDefinition = { name: "wf", steps: [{ use: "n" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
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
      writeBundle(env.cwd, "n", "#!/bin/sh\necho n\n");
      const wf: WorkflowDefinition = { name: "wf", steps: [{ use: "n" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const onlyId = await triggerAndAwait(app, "wf", waitForFinished);

      const past = (await (await app.request(`/api/runs?cursor=${onlyId}`)).json()) as RunsPageBody;
      expect(past.runs).toEqual([]);
      expect(past.nextCursor).toBeNull();
    });

    it("rejects an out-of-range limit with 400", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });

      const tooSmall = await app.request("/api/runs?limit=0");
      expect(tooSmall.status).toBe(400);
      // Field path travels alongside the human-readable summary so
      // non-modal callers can pinpoint the offending query param.
      const tooSmallBody = (await tooSmall.json()) as {
        error: string;
        issues: { path: (string | number)[]; message: string }[];
      };
      expect(tooSmallBody.issues).toHaveLength(1);
      expect(tooSmallBody.issues[0]?.path).toEqual(["limit"]);

      const tooBig = await app.request("/api/runs?limit=101");
      expect(tooBig.status).toBe(400);

      const nan = await app.request("/api/runs?limit=banana");
      expect(nan.status).toBe(400);
    });

    it("rejects an unknown cursor with 400", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/runs?cursor=does-not-exist");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'cursor "does-not-exist" not found' });
    });

    it("attaches each run's articles to its row in a single aggregation across the page", async () => {
      writeBundle(env.cwd, "step", "#!/bin/sh\necho s\n");
      writeBundle(env.cwd, "digest", "#!/bin/sh\necho digest-body\n");
      writeBundle(env.cwd, "notes", "#!/bin/sh\necho notes-body\n");
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
      env.registry.replace(
        new Map([
          [noPub.name, noPub],
          [onePub.name, onePub],
          [twoPub.name, twoPub],
        ]),
      );

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const trigger = async (name: string) => {
        const res = await app.request(`/api/workflows/${name}/runs`, {
          method: "POST",
          headers: CLIENT_HEADERS,
        });
        const { runId } = (await res.json()) as { runId: string };
        await waitForFinished(runId);
        return runId;
      };
      const noPubId = await trigger("no-pub");
      const onePubId = await trigger("one-pub");
      const twoPubId = await trigger("two-pub");

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
      writeBundle(env.cwd, "step", "#!/bin/sh\necho s\n");
      writeBundle(env.cwd, "digest", "#!/bin/sh\necho digest-body\n");
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
      env.registry.replace(
        new Map([
          [wfA.name, wfA],
          [wfB.name, wfB],
        ]),
      );

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const trigger = async (name: string) => {
        const res = await app.request(`/api/workflows/${name}/runs`, {
          method: "POST",
          headers: CLIENT_HEADERS,
        });
        const { runId } = (await res.json()) as { runId: string };
        await waitForFinished(runId);
        return runId;
      };
      const oldRunId = await trigger("wf-a");
      const newRunId = await trigger("wf-b");

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
      writeBundle(env.cwd, "step", "#!/bin/sh\necho s\n");
      const wf: WorkflowDefinition = { name: "plain", steps: [{ use: "step" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
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
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/runs/missing");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'run "missing" not found' });
    });

    it("returns the run with steps ordered by index", async () => {
      writeBundle(env.cwd, "one", "#!/bin/sh\necho one\n");
      const wf: WorkflowDefinition = {
        name: "two-step",
        steps: [{ use: "one" }, { sh: "cat" }],
      };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
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
        steps: Array<{ index: number; kind: string; output: unknown }>;
      };
      expect(body.run).toMatchObject({ id: runId, workflowName: "two-step", isInterrupted: false });
      expect(body.steps.map((n) => n.index)).toEqual([0, 1]);
      expect(body.steps[0].output).toBe("one\n");
      expect(body.steps[0].kind).toBe("use");
      expect(body.steps[1].kind).toBe("sh");
    });

    it("flags isInterrupted when the workflow no longer exists", async () => {
      writeBundle(env.cwd, "x", "#!/bin/sh\necho x\n");
      const wf: WorkflowDefinition = { name: "ephemeral", steps: [{ use: "x" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const trigger = await app.request("/api/workflows/ephemeral/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      env.registry.replace(new Map());

      const res = await app.request(`/api/runs/${runId}`);
      const body = (await res.json()) as { run: { isInterrupted: boolean } };
      expect(body.run.isInterrupted).toBe(true);
    });

    it("returns an empty articles array and unchanged step list when the run has no publishes", async () => {
      writeBundle(env.cwd, "one", "#!/bin/sh\necho one\n");
      const wf: WorkflowDefinition = { name: "plain", steps: [{ use: "one" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
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
      writeBundle(env.cwd, "one", "#!/bin/sh\necho one\n");
      writeBundle(env.cwd, "digest", "#!/bin/sh\necho digest-body\n");
      writeBundle(env.cwd, "notes", "#!/bin/sh\necho notes-body\n");
      const wf: WorkflowDefinition = {
        name: "with-publish",
        steps: [{ use: "one" }],
        publish: [
          { name: "digest", title: "Digest Title", use: "digest" },
          { name: "release-notes", use: "notes" },
        ],
      };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
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
      writeBundle(env.cwd, "one", "#!/bin/sh\necho one\n");
      writeBundle(env.cwd, "bad", "#!/bin/sh\nexit 2\n");
      writeBundle(env.cwd, "good", "#!/bin/sh\necho good-body\n");
      const wf: WorkflowDefinition = {
        name: "pub-fail",
        steps: [{ use: "one" }],
        publish: [
          { name: "bad", use: "bad" },
          { name: "good", use: "good" },
        ],
      };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
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
      writeBundle(env.cwd, "one", "#!/bin/sh\necho one\n");
      // Long-running publish so we can observe the in-flight row mid-execution.
      // `exec 1>&- 2>&-` closes stdio before sleep is forked so cancel readers
      // unblock cleanly when the test tears down (same idiom used elsewhere).
      const wf: WorkflowDefinition = {
        name: "slow-publish",
        steps: [{ use: "one" }],
        publish: [{ name: "slow", sh: "exec 1>&- 2>&-; sleep 5" }],
      };
      env.registry.replace(new Map([[wf.name, wf]]));

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
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        bus,
        cancelRegistry,
      });

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

    it("returns an empty recommendations array when the run emitted none", async () => {
      writeBundle(env.cwd, "one", "#!/bin/sh\necho one\n");
      const wf: WorkflowDefinition = { name: "no-recs", steps: [{ use: "one" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const trigger = await app.request("/api/workflows/no-recs/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { run: { recommendations: unknown[] } };
      expect(body.run.recommendations).toEqual([]);
    });

    it("returns a single emitted recommendation as untriggered with null actioned fields", async () => {
      writeBundle(
        env.cwd,
        "emit-one",
        `#!/bin/sh
echo '{"title":"Review PR #1","workflow":"pr-review","description":"+10/-2","inputs":{"pr_number":"1"}}' > "$KIRI_RECOMMENDATIONS_FILE"
`,
      );
      const wf: WorkflowDefinition = { name: "single-rec", steps: [{ use: "emit-one" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const trigger = await app.request("/api/workflows/single-rec/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: {
          recommendations: Array<{
            id: string;
            index: number;
            title: string;
            description: string | null;
            workflow: string;
            inputs: Record<string, string> | null;
            actionedRunId: string | null;
            actionedAt: string | null;
            actionedRunStatus: string | null;
          }>;
        };
      };
      expect(body.run.recommendations).toHaveLength(1);
      const [rec] = body.run.recommendations;
      expect(rec).toMatchObject({
        index: 0,
        title: "Review PR #1",
        description: "+10/-2",
        workflow: "pr-review",
        inputs: { pr_number: "1" },
        actionedRunId: null,
        actionedAt: null,
        actionedRunStatus: null,
      });
      // `id` is the rec row's uuid — needed by the future action endpoint.
      expect(typeof rec?.id).toBe("string");
      expect(rec?.id.length).toBeGreaterThan(0);
    });

    it("returns multiple recommendations in emission index order", async () => {
      writeBundle(
        env.cwd,
        "emit-many",
        `#!/bin/sh
cat > "$KIRI_RECOMMENDATIONS_FILE" <<'EOF'
{"title":"A","workflow":"w","description":"first"}
{"title":"B","workflow":"w"}
{"title":"C","workflow":"w"}
EOF
`,
      );
      const wf: WorkflowDefinition = { name: "multi-rec", steps: [{ use: "emit-many" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const trigger = await app.request("/api/workflows/multi-rec/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId } = (await trigger.json()) as { runId: string };
      await waitForFinished(runId);

      const res = await app.request(`/api/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: { recommendations: Array<{ index: number; title: string }> };
      };
      expect(body.run.recommendations.map((r) => [r.index, r.title])).toEqual([
        [0, "A"],
        [1, "B"],
        [2, "C"],
      ]);
    });

    it("includes the actioned run's status on a triggered recommendation", async () => {
      writeBundle(
        env.cwd,
        "emit-one",
        `#!/bin/sh
echo '{"title":"Spawn","workflow":"target"}' > "$KIRI_RECOMMENDATIONS_FILE"
`,
      );
      writeBundle(env.cwd, "noop", "#!/bin/sh\necho ok\n");
      const producer: WorkflowDefinition = { name: "producer", steps: [{ use: "emit-one" }] };
      const target: WorkflowDefinition = { name: "target", steps: [{ use: "noop" }] };
      env.registry.replace(
        new Map([
          [producer.name, producer],
          [target.name, target],
        ]),
      );

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const producerRes = await app.request("/api/workflows/producer/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId: producerRunId } = (await producerRes.json()) as { runId: string };
      await waitForFinished(producerRunId);

      const targetRes = await app.request("/api/workflows/target/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId: targetRunId } = (await targetRes.json()) as { runId: string };
      await waitForFinished(targetRunId);

      // Simulate the action endpoint (#189) wiring the rec to the spawned run.
      const actionedAt = new Date("2026-05-09T13:00:00.000Z");
      env.db
        .update(recommendations)
        .set({ actionedRunId: targetRunId, actionedAt })
        .where(eq(recommendations.runId, producerRunId))
        .run();

      const res = await app.request(`/api/runs/${producerRunId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: {
          recommendations: Array<{
            actionedRunId: string | null;
            actionedAt: string | null;
            actionedRunStatus: string | null;
          }>;
        };
      };
      expect(body.run.recommendations).toHaveLength(1);
      expect(body.run.recommendations[0]).toMatchObject({
        actionedRunId: targetRunId,
        actionedAt: actionedAt.toISOString(),
        actionedRunStatus: "ok",
      });
    });

    it("returns null actioned fields for untriggered rows when others on the same run are actioned", async () => {
      writeBundle(
        env.cwd,
        "emit-two",
        `#!/bin/sh
cat > "$KIRI_RECOMMENDATIONS_FILE" <<'EOF'
{"title":"First","workflow":"w"}
{"title":"Second","workflow":"w"}
EOF
`,
      );
      writeBundle(env.cwd, "noop", "#!/bin/sh\necho ok\n");
      const producer: WorkflowDefinition = { name: "mixed", steps: [{ use: "emit-two" }] };
      const target: WorkflowDefinition = { name: "target", steps: [{ use: "noop" }] };
      env.registry.replace(
        new Map([
          [producer.name, producer],
          [target.name, target],
        ]),
      );

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const producerRes = await app.request("/api/workflows/mixed/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId: producerRunId } = (await producerRes.json()) as { runId: string };
      await waitForFinished(producerRunId);

      const targetRes = await app.request("/api/workflows/target/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      const { runId: targetRunId } = (await targetRes.json()) as { runId: string };
      await waitForFinished(targetRunId);

      // Action only the first rec; the second remains untriggered.
      env.db
        .update(recommendations)
        .set({ actionedRunId: targetRunId, actionedAt: new Date() })
        .where(and(eq(recommendations.runId, producerRunId), eq(recommendations.index, 0)))
        .run();

      const res = await app.request(`/api/runs/${producerRunId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        run: {
          recommendations: Array<{
            index: number;
            actionedRunId: string | null;
            actionedRunStatus: string | null;
          }>;
        };
      };
      expect(
        body.run.recommendations.map((r) => [r.index, r.actionedRunId, r.actionedRunStatus]),
      ).toEqual([
        [0, targetRunId, "ok"],
        [1, null, null],
      ]);
    });
  });

  describe("GET /api/runs/:id/published/:name", () => {
    const setupPublishingRun = async () => {
      writeBundle(env.cwd, "one", "#!/bin/sh\necho one\n");
      writeBundle(env.cwd, "digest", "#!/bin/sh\nprintf '# Heading\\n\\nBody paragraph.\\n'\n");
      const wf: WorkflowDefinition = {
        name: "with-publish",
        steps: [{ use: "one" }],
        publish: [{ name: "digest", title: "Digest Title", use: "digest" }],
      };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
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
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
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
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/runs/any-id/published/Bad_Name");
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: string;
        issues: { path: (string | number)[]; message: string }[];
      };
      expect(body.error).toMatch(/publish name must match/);
      // Field path travels alongside the human-readable summary so
      // non-modal callers can pinpoint the offending path param.
      expect(body.issues).toHaveLength(1);
      expect(body.issues[0]?.path).toEqual(["name"]);
    });
  });

  describe("POST /api/runs/:id/cancel", () => {
    it("is not mounted when no cancel registry is supplied", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/runs/anything/cancel", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for an unknown run id", async () => {
      const cancelRegistry = createCancelRegistry();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        cancelRegistry,
      });
      const res = await app.request("/api/runs/missing/cancel", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'run "missing" not found' });
    });

    it("returns 409 when the run is already in a terminal state", async () => {
      writeBundle(env.cwd, "quick", "#!/bin/sh\necho done\n");
      const wf: WorkflowDefinition = { name: "quick", steps: [{ use: "quick" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const cancelRegistry = createCancelRegistry();
      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        bus,
        cancelRegistry,
      });

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
      env.registry.replace(new Map([[wf.name, wf]]));

      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        bus,
        cancelRegistry,
      });

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
      const final = env.db.select().from(runs).where(eq(runs.id, runId)).get();
      expect(final?.status).toBe("cancelled");
    });

    it("rejects cancel without the X-Kiri-Client header (CSRF gate)", async () => {
      const cancelRegistry = createCancelRegistry();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        cancelRegistry,
      });
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
      env.db
        .insert(runs)
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
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        cancelRegistry,
      });
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
      env.db
        .insert(runs)
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
      env.db
        .insert(runSteps)
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
      env.db
        .insert(articles)
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
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/runs/missing", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'run "missing" not found' });
    });

    it("returns 409 when the run is still running", async () => {
      const id = "still-running";
      env.db
        .insert(runs)
        .values({
          id,
          workflowName: "demo",
          status: "running",
          trigger: "manual",
          startedAt: new Date(),
          definitionSnapshot: { name: "demo", steps: [] },
        })
        .run();

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request(`/api/runs/${id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: `run "${id}" is in flight; cancel it first` });

      // Nothing was deleted — caller must cancel first.
      expect(env.db.select().from(runs).where(eq(runs.id, id)).get()).toBeDefined();
    });

    it("rejects DELETE without the X-Kiri-Client header (CSRF gate)", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
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
      const scratch = join(env.cwd, ".kiri", "runs", id);
      mkdirSync(scratch, { recursive: true });
      writeFileSync(join(scratch, "leftover.txt"), "crash residue");

      const bus = createEventBus();
      const seen: KiriEvent[] = [];
      bus.subscribe((e) => seen.push(e));

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const res = await app.request(`/api/runs/${id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");

      expect(env.db.select().from(runs).where(eq(runs.id, id)).get()).toBeUndefined();
      expect(env.db.select().from(runSteps).where(eq(runSteps.runId, id)).all()).toEqual([]);
      expect(env.db.select().from(articles).where(eq(articles.runId, id)).all()).toEqual([]);
      expect(existsSync(scratch)).toBe(false);
      expect(seen).toContainEqual({ type: "run.deleted", id });
    });

    it("returns 204 even with no scratch dir on disk (idempotent cleanup)", async () => {
      const id = "no-scratch";
      seedTerminalRun(id);

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request(`/api/runs/${id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(204);
      expect(env.db.select().from(runs).where(eq(runs.id, id)).get()).toBeUndefined();
    });

    it("returns 404 on a double-delete (the run is gone after the first)", async () => {
      const id = "twice";
      seedTerminalRun(id);

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
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

    // Seeds a recommendation row directly so cascade tests don't need to
    // drive the runner's emission path. The triggered/untriggered split is
    // controlled by `actionedRunId` + `actionedAt`.
    const seedRecommendation = (
      id: string,
      opts: {
        runId: string;
        index?: number;
        actionedRunId?: string | null;
        actionedAt?: Date | null;
      },
    ) => {
      env.db
        .insert(recommendations)
        .values({
          id,
          runId: opts.runId,
          index: opts.index ?? 0,
          title: "rec",
          workflow: "target",
          actionedRunId: opts.actionedRunId ?? null,
          actionedAt: opts.actionedAt ?? null,
        })
        .run();
    };

    it("removes the deleted run's own recommendations alongside its other rows", async () => {
      const id = "owns-recs";
      seedTerminalRun(id);
      seedRecommendation("rec-a", { runId: id, index: 0 });
      seedRecommendation("rec-b", { runId: id, index: 1 });

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request(`/api/runs/${id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(204);

      expect(
        env.db.select().from(recommendations).where(eq(recommendations.runId, id)).all(),
      ).toEqual([]);
    });

    it("nulls actionedRunId + actionedAt on other runs' recs pointing at the deleted run", async () => {
      const deletedId = "deleted-target";
      const producerId = "producer";
      seedTerminalRun(deletedId);
      seedTerminalRun(producerId);
      seedRecommendation("rec-inbound", {
        runId: producerId,
        actionedRunId: deletedId,
        actionedAt: new Date("2026-05-09T13:00:00.000Z"),
      });

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request(`/api/runs/${deletedId}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(204);

      // The rec row survives on the producer; its link is cleared so the
      // trigger button flips back to actionable.
      const inbound = env.db
        .select()
        .from(recommendations)
        .where(eq(recommendations.id, "rec-inbound"))
        .get();
      expect(inbound).toMatchObject({
        runId: producerId,
        actionedRunId: null,
        actionedAt: null,
      });
    });

    it("cascades own recs and nulls inbound rec links in a single delete", async () => {
      const deletedId = "mixed-delete";
      const producerId = "mixed-producer";
      seedTerminalRun(deletedId);
      seedTerminalRun(producerId);
      seedRecommendation("rec-own", { runId: deletedId, index: 0 });
      seedRecommendation("rec-inbound", {
        runId: producerId,
        actionedRunId: deletedId,
        actionedAt: new Date(),
      });

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request(`/api/runs/${deletedId}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(204);

      // Own rec is gone.
      expect(
        env.db.select().from(recommendations).where(eq(recommendations.id, "rec-own")).get(),
      ).toBeUndefined();
      // Inbound rec survives with its link cleared.
      expect(
        env.db.select().from(recommendations).where(eq(recommendations.id, "rec-inbound")).get(),
      ).toMatchObject({ actionedRunId: null, actionedAt: null });
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
      env.db
        .insert(runs)
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
      env.db
        .insert(runSteps)
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
      env.db
        .insert(articles)
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
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/runs/missing/rerun", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'run "missing" not found' });
    });

    it("returns 409 when the run is still running", async () => {
      const id = "still-running";
      env.db
        .insert(runs)
        .values({
          id,
          workflowName: "demo",
          status: "running",
          trigger: "manual",
          startedAt: new Date(),
          definitionSnapshot: { name: "demo", steps: [] },
        })
        .run();

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
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

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request(`/api/runs/${id}/rerun`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'workflow "gone" no longer exists; re-create it first',
      });

      // Nothing was wiped — the rerun was rejected before the cascade.
      expect(env.db.select().from(runSteps).where(eq(runSteps.runId, id)).all()).toHaveLength(1);
      expect(env.db.select().from(articles).where(eq(articles.runId, id)).all()).toHaveLength(1);
    });

    it("rejects POST without the X-Kiri-Client header (CSRF gate)", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/runs/anything/rerun", { method: "POST" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "X-Kiri-Client header required" });
    });

    it("logs and absorbs rejections from the background runner so they never go unhandled", async () => {
      const id = "rerun-crash";
      writeBundle(env.cwd, "hi", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = { name: "demo", steps: [{ use: "hi" }] };
      env.registry.replace(new Map([[wf.name, wf]]));
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
        const { bus, waitForFinished } = createRunWaiter();
        const app = createApp({
          db: env.db,
          registry: env.registry,
          cwd: env.cwd,
          bus,
          cancelRegistry: throwingRegistry,
        });
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

    describe("inputs validation", () => {
      const writePassthroughBundle = (cwd: string) =>
        writeBundle(
          cwd,
          "echo-env",
          '#!/bin/sh\necho "pr=$PR_NUMBER owner=$OWNER branch=$BRANCH"\n',
        );

      const inputsWorkflow: WorkflowDefinition = {
        name: "with-inputs",
        inputs: [
          { name: "pr_number", required: true },
          { name: "owner" },
          { name: "branch", default: "main" },
        ],
        steps: [
          {
            use: "echo-env",
            env: {
              PR_NUMBER: { input: "pr_number" },
              OWNER: { input: "owner" },
              BRANCH: { input: "branch" },
            },
          },
        ],
      };

      const noInputsWorkflow: WorkflowDefinition = {
        name: "no-inputs-rerun",
        steps: [{ use: "echo-env" }],
      };

      it("accepts a payload and snapshots the resolved values onto the rerun", async () => {
        const id = "to-rerun-with-inputs";
        writePassthroughBundle(env.cwd);
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        seedTerminalRun(id, { workflowName: inputsWorkflow.name });

        const { bus, waitForFinished } = createRunWaiter();
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
        const res = await app.request(`/api/runs/${id}/rerun`, {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { pr_number: "42", owner: "kiri" } }),
        });
        expect(res.status).toBe(202);
        await waitForFinished(id);

        const run = env.db.select().from(runs).where(eq(runs.id, id)).get();
        // Resolved snapshot reflects the rerun payload (supplied + default-applied),
        // not the prior attempt's values.
        expect(run?.inputs).toEqual({ pr_number: "42", owner: "kiri", branch: "main" });
        expect(run?.status).toBe("ok");
      });

      it("returns 400 when a required input is missing", async () => {
        const id = "rerun-missing-required";
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        seedTerminalRun(id, { workflowName: inputsWorkflow.name });

        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request(`/api/runs/${id}/rerun`, {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { owner: "kiri" } }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          error: string;
          issues: { path: (string | number)[]; message: string }[];
        };
        expect(body.error).toBe('input "pr_number" is required');
        expect(body.issues).toContainEqual(
          expect.objectContaining({
            path: ["pr_number"],
            message: 'input "pr_number" is required',
          }),
        );

        // Validation rejects before the cascade — prior step rows + articles
        // are still intact for retry.
        expect(env.db.select().from(runSteps).where(eq(runSteps.runId, id)).all()).toHaveLength(1);
        expect(env.db.select().from(articles).where(eq(articles.runId, id)).all()).toHaveLength(1);
      });

      it("returns 400 when the payload contains an unknown key", async () => {
        const id = "rerun-unknown-key";
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        seedTerminalRun(id, { workflowName: inputsWorkflow.name });

        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request(`/api/runs/${id}/rerun`, {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { pr_number: "42", surprise: "x" } }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          error: string;
          issues: { path: (string | number)[]; message: string }[];
        };
        expect(body.error).toContain("surprise");
        expect(body.issues).toContainEqual(
          expect.objectContaining({ path: [], message: expect.stringContaining("surprise") }),
        );
      });

      it("returns 400 when an input value is not a string", async () => {
        const id = "rerun-non-string";
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        seedTerminalRun(id, { workflowName: inputsWorkflow.name });

        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request(`/api/runs/${id}/rerun`, {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { pr_number: 42 } }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBeTruthy();
      });

      it("returns 400 when the body is malformed JSON", async () => {
        const id = "rerun-bad-json";
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        seedTerminalRun(id, { workflowName: inputsWorkflow.name });

        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request(`/api/runs/${id}/rerun`, {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: "{ not json",
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid JSON body" });
      });

      it("returns 400 when a no-inputs workflow receives a non-empty payload", async () => {
        const id = "rerun-no-inputs-with-payload";
        writePassthroughBundle(env.cwd);
        env.registry.replace(new Map([[noInputsWorkflow.name, noInputsWorkflow]]));
        seedTerminalRun(id, { workflowName: noInputsWorkflow.name });

        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request(`/api/runs/${id}/rerun`, {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { pr_number: "42" } }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          error: string;
          issues: { path: (string | number)[]; message: string }[];
        };
        expect(body.error).toContain("pr_number");
        expect(body.issues).toContainEqual(
          expect.objectContaining({ path: [], message: expect.stringContaining("pr_number") }),
        );
      });

      it("reruns a no-inputs workflow with no body, preserving current behaviour", async () => {
        const id = "rerun-no-inputs-no-body";
        writePassthroughBundle(env.cwd);
        env.registry.replace(new Map([[noInputsWorkflow.name, noInputsWorkflow]]));
        seedTerminalRun(id, { workflowName: noInputsWorkflow.name });

        const { bus, waitForFinished } = createRunWaiter();
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
        const res = await app.request(`/api/runs/${id}/rerun`, {
          method: "POST",
          headers: CLIENT_HEADERS,
        });
        expect(res.status).toBe(202);
        await waitForFinished(id);

        const run = env.db.select().from(runs).where(eq(runs.id, id)).get();
        expect(run?.inputs).toBeNull();
        expect(run?.status).toBe("ok");
      });
    });

    it("wipes prior steps + articles + scratch dir and re-runs under the same id", async () => {
      const id = "to-rerun";
      writeBundle(env.cwd, "hi", "#!/bin/sh\necho fresh\n");
      const wf: WorkflowDefinition = { name: "demo", steps: [{ use: "hi" }] };
      env.registry.replace(new Map([[wf.name, wf]]));
      seedTerminalRun(id, { trigger: "scheduled" });

      // Scratch-dir leftover (mimicking a crashed runner). Should be removed
      // before the rerun starts so stale files don't pollute the new run.
      const scratch = join(env.cwd, ".kiri", "runs", id);
      mkdirSync(scratch, { recursive: true });
      writeFileSync(join(scratch, "leftover.txt"), "crash residue");

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const res = await app.request(`/api/runs/${id}/rerun`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ runId: id, status: "running" });

      await waitForFinished(id);

      // One row, same id, status flipped to ok, trigger preserved.
      const allRows = env.db.select().from(runs).where(eq(runs.id, id)).all();
      expect(allRows).toHaveLength(1);
      expect(allRows[0].status).toBe("ok");
      expect(allRows[0].trigger).toBe("scheduled");
      expect(allRows[0].error).toBeNull();
      expect(allRows[0].definitionSnapshot).toMatchObject({
        name: "demo",
        steps: [{ use: "hi" }],
      });

      // Old article gone; old step row replaced by the fresh run's step.
      const steps = env.db.select().from(runSteps).where(eq(runSteps.runId, id)).all();
      expect(steps).toHaveLength(1);
      expect(steps[0].status).toBe("ok");
      expect(steps[0].output).toBe("fresh\n");
      expect(steps.some((s) => s.id === `${id}-step-0`)).toBe(false);
      expect(env.db.select().from(articles).where(eq(articles.runId, id)).all()).toEqual([]);

      // Leftover scratch file is gone.
      expect(existsSync(join(scratch, "leftover.txt"))).toBe(false);
    });

    it("wipes the rerun's own recs but leaves inbound rec links pointing at it intact", async () => {
      const id = "rerun-with-recs";
      writeBundle(env.cwd, "hi", "#!/bin/sh\necho fresh\n");
      const wf: WorkflowDefinition = { name: "demo", steps: [{ use: "hi" }] };
      env.registry.replace(new Map([[wf.name, wf]]));
      seedTerminalRun(id, { trigger: "manual" });

      // Producer run with a rec pointing at the run we're about to rerun.
      // The id persists across rerun so the link should still resolve.
      const producerId = "rerun-producer";
      env.db
        .insert(runs)
        .values({
          id: producerId,
          workflowName: "producer",
          status: "ok",
          trigger: "manual",
          startedAt: new Date(),
          finishedAt: new Date(),
          definitionSnapshot: { name: "producer", steps: [] },
        })
        .run();
      const actionedAt = new Date("2026-05-09T13:00:00.000Z");
      env.db
        .insert(recommendations)
        .values({
          id: "rec-inbound",
          runId: producerId,
          index: 0,
          title: "Points at the rerun target",
          workflow: "demo",
          actionedRunId: id,
          actionedAt,
        })
        .run();
      // The rerun target's own prior rec — should be wiped.
      env.db
        .insert(recommendations)
        .values({
          id: "rec-own",
          runId: id,
          index: 0,
          title: "Own prior rec",
          workflow: "anything",
        })
        .run();

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const res = await app.request(`/api/runs/${id}/rerun`, {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(202);
      await waitForFinished(id);

      // Own rec gone.
      expect(
        env.db.select().from(recommendations).where(eq(recommendations.id, "rec-own")).get(),
      ).toBeUndefined();
      // Inbound rec retained with its actionedRunId + actionedAt intact —
      // the rerun reused the same id, so the link still resolves.
      expect(
        env.db.select().from(recommendations).where(eq(recommendations.id, "rec-inbound")).get(),
      ).toMatchObject({ actionedRunId: id, actionedAt });
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
      env.registry.replace(new Map([[wf.name, wf]]));
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        bus,
        cancelRegistry,
      });

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
      env.registry.replace(new Map([[wf.name, wf]]));
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        bus,
        cancelRegistry,
      });

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
      env.registry.replace(new Map([[wf.name, wf]]));
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        bus,
        cancelRegistry,
      });

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
      env.registry.replace(new Map([[wf.name, wf]]));
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const bus = createEventBus();
      const seen: KiriEvent[] = [];
      const finished = new Promise<void>((resolve) => {
        bus.subscribe((e) => {
          seen.push(e);
          if (e.type === "run.finished") resolve();
        });
      });
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        bus,
        cancelRegistry,
      });

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
