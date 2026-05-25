import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { runs } from "../db/schema.ts";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import { createApp } from "../index.ts";
import type { WorkflowDefinition } from "../workflows/index.ts";
import {
  CLIENT_HEADERS,
  type TestEnv,
  createRunWaiter,
  createTestEnv,
  writeBundle,
} from "./test-helpers.ts";

describe("workflows routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  describe("GET /api/workflows", () => {
    it("returns an empty array when the registry is empty", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/workflows");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("summarizes registry entries with name and steps", async () => {
      const wf: WorkflowDefinition = {
        name: "demo",
        steps: [{ use: "demo" }],
      };
      env.registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/workflows");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]).toEqual({
        name: "demo",
        steps: [{ use: "demo" }],
      });
    });

    it("omits publish and summarize when the workflow has neither", async () => {
      const wf: WorkflowDefinition = { name: "steps-only", steps: [{ sh: "echo hi" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/workflows");
      const body = (await res.json()) as Array<Record<string, unknown>>;
      // Absence is signalled by missing keys (JSON.stringify drops `undefined`),
      // never by `[]` or `null`. Callers branch on "field present" with no
      // empty-collection ambiguity.
      expect("publish" in body[0]).toBe(false);
      expect("summarize" in body[0]).toBe(false);
      expect("inputs" in body[0]).toBe(false);
    });

    it("projects the inputs array as-is when the workflow declares one", async () => {
      const wf: WorkflowDefinition = {
        name: "with-inputs",
        inputs: [
          { name: "pr_number", description: "PR to review", required: true },
          { name: "branch", default: "main" },
        ],
        steps: [{ sh: "echo hi" }],
      };
      env.registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/workflows");
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(body[0].inputs).toEqual([
        { name: "pr_number", description: "PR to review", required: true },
        { name: "branch", default: "main" },
      ]);
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
      env.registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
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
      env.registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
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
      env.registry.replace(new Map([[wf.name, wf]]));

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/workflows");
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(body[0].publish).toEqual([{ name: "digest", title: "Digest", sh: "echo body" }]);
      expect(body[0].summarize).toEqual({ sh: "echo one-liner" });
    });
  });

  describe("POST /api/workflows/:name/runs", () => {
    it("returns 404 for an unknown workflow name", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/workflows/nope/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'workflow "nope" not found' });
    });

    it("returns 202 with runId and running status the moment a run starts", async () => {
      writeBundle(env.cwd, "hi", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = {
        name: "greeter",
        steps: [{ use: "hi" }],
      };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const res = await app.request("/api/workflows/greeter/runs", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { runId: string; status: string };
      expect(body.status).toBe("running");
      expect(body.runId).toMatch(/[0-9a-f-]{36}/);

      // Run row exists immediately, still in `running` state.
      const initial = env.db.select().from(runs).where(eq(runs.id, body.runId)).get();
      expect(initial?.workflowName).toBe("greeter");
      expect(initial?.trigger).toBe("manual");
      expect(initial?.status).toBe("running");
      expect(initial?.finishedAt).toBeNull();

      await waitForFinished(body.runId);

      const finished = env.db.select().from(runs).where(eq(runs.id, body.runId)).get();
      expect(finished?.status).toBe("ok");
      expect(finished?.finishedAt).toBeInstanceOf(Date);
    });

    it("logs and absorbs rejections from the background runner so they never go unhandled", async () => {
      writeBundle(env.cwd, "hi", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = { name: "throwy", steps: [{ use: "hi" }] };
      env.registry.replace(new Map([[wf.name, wf]]));
      // Pre-create .kiri/runs as a *file* so the runner's mkdirSync(.../runs/<id>)
      // throws ENOTDIR — exercises the route's `done.catch` so the rejection is
      // logged rather than left unhandled.
      writeFileSync(join(env.cwd, ".kiri", "runs"), "blocker");

      const errors: unknown[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.join(" "));
      };

      try {
        const { bus, waitForFinished } = createRunWaiter();
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
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
      writeBundle(env.cwd, "hi", "#!/bin/sh\necho hello\n");
      const wf: WorkflowDefinition = {
        name: "greeter",
        steps: [{ use: "hi" }],
      };
      env.registry.replace(new Map([[wf.name, wf]]));

      const bus = createEventBus();
      const seen: KiriEvent[] = [];
      const finished = new Promise<void>((resolve) => {
        bus.subscribe((e) => {
          seen.push(e);
          if (e.type === "run.finished") resolve();
        });
      });

      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
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
        name: "no-inputs",
        steps: [{ use: "echo-env" }],
      };

      it("accepts a payload with required, optional, and default-applied inputs and snapshots the resolved values", async () => {
        writePassthroughBundle(env.cwd);
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));

        const { bus, waitForFinished } = createRunWaiter();
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
        const res = await app.request("/api/workflows/with-inputs/runs", {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { pr_number: "42", owner: "kiri" } }),
        });
        expect(res.status).toBe(202);
        const { runId } = (await res.json()) as { runId: string };
        await waitForFinished(runId);

        const run = env.db.select().from(runs).where(eq(runs.id, runId)).get();
        // Optional + supplied is kept; required is kept; default fills in for
        // the omitted entry — what `runs.inputs` records is the resolved map.
        expect(run?.inputs).toEqual({ pr_number: "42", owner: "kiri", branch: "main" });
        expect(run?.status).toBe("ok");
      });

      it("returns 400 when a required input is missing", async () => {
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request("/api/workflows/with-inputs/runs", {
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
        expect(env.db.select().from(runs).all()).toHaveLength(0);
      });

      it("returns 400 when a required input is supplied as an empty string", async () => {
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request("/api/workflows/with-inputs/runs", {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { pr_number: "" } }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          error: string;
          issues: { path: (string | number)[]; message: string }[];
        };
        expect(body.error).toBe('input "pr_number" is required');
      });

      it("returns 400 when the payload contains an unknown key", async () => {
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request("/api/workflows/with-inputs/runs", {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { pr_number: "42", surprise: "x" } }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          error: string;
          issues: { path: (string | number)[]; message: string }[];
        };
        // Unknown keys are reported via Zod's strict-object check; the
        // issue carries no field path since the violation is at the
        // object level, and the headline message identifies the offender.
        expect(body.error).toContain("surprise");
        expect(body.issues).toContainEqual(
          expect.objectContaining({ path: [], message: expect.stringContaining("surprise") }),
        );
      });

      it("returns 400 when an input value is not a string", async () => {
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request("/api/workflows/with-inputs/runs", {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { pr_number: 42 } }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          error: string;
          issues: { path: (string | number)[]; message: string }[];
        };
        expect(body.error).toBeTruthy();
        // Field path travels alongside the human-readable summary so
        // non-modal callers (CLI, debug) can pinpoint the offending input.
        expect(body.issues).toHaveLength(1);
        expect(body.issues[0]?.path).toEqual(["inputs", "pr_number"]);
        expect(body.issues[0]?.message).toBeTruthy();
      });

      it("returns 400 when the body is malformed JSON", async () => {
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request("/api/workflows/with-inputs/runs", {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: "{ not json",
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid JSON body" });
      });

      it("returns 413 when the request body exceeds the size limit", async () => {
        env.registry.replace(new Map([[inputsWorkflow.name, inputsWorkflow]]));
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        // 256 KB + 1 — the bodyLimit middleware reads Content-Length and
        // rejects before optionalInvokeBody ever touches the payload.
        const oversized = "a".repeat(256 * 1024 + 1);
        const res = await app.request("/api/workflows/with-inputs/runs", {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: oversized,
        });
        expect(res.status).toBe(413);
        expect(await res.json()).toEqual({ error: "request body too large" });
      });

      it("returns 400 when a no-inputs workflow receives a non-empty payload", async () => {
        writePassthroughBundle(env.cwd);
        env.registry.replace(new Map([[noInputsWorkflow.name, noInputsWorkflow]]));
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
        const res = await app.request("/api/workflows/no-inputs/runs", {
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

      it("invokes a no-inputs workflow with no body, preserving current behaviour", async () => {
        writePassthroughBundle(env.cwd);
        env.registry.replace(new Map([[noInputsWorkflow.name, noInputsWorkflow]]));

        const { bus, waitForFinished } = createRunWaiter();
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
        const res = await app.request("/api/workflows/no-inputs/runs", {
          method: "POST",
          headers: CLIENT_HEADERS,
        });
        expect(res.status).toBe(202);
        const { runId } = (await res.json()) as { runId: string };
        await waitForFinished(runId);

        const run = env.db.select().from(runs).where(eq(runs.id, runId)).get();
        expect(run?.inputs).toBeNull();
        expect(run?.status).toBe("ok");
      });

      it("invokes a no-inputs workflow with an empty inputs payload", async () => {
        writePassthroughBundle(env.cwd);
        env.registry.replace(new Map([[noInputsWorkflow.name, noInputsWorkflow]]));

        const { bus, waitForFinished } = createRunWaiter();
        const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
        const res = await app.request("/api/workflows/no-inputs/runs", {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: {} }),
        });
        expect(res.status).toBe(202);
        const { runId } = (await res.json()) as { runId: string };
        await waitForFinished(runId);
        const run = env.db.select().from(runs).where(eq(runs.id, runId)).get();
        expect(run?.status).toBe("ok");
      });
    });
  });
});
