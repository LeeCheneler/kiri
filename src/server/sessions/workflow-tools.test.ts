import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { createConfigStore } from "../config/store.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import { createCancelRegistry } from "../runner/cancel-registry.ts";
import {
  type Registry,
  type WorkflowDefinition,
  createRegistry,
  workflowSchema,
} from "../workflows/index.ts";
import { type WorkflowToolsDeps, workflowTools } from "./workflow-tools.ts";

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (
  t: ToolSet[string],
  input: unknown,
  options?: Partial<ToolExecutionOptions>,
): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)(input, {
    toolCallId: "call-1",
    messages: [],
    ...options,
  } as ToolExecutionOptions);

const define = (definition: unknown): WorkflowDefinition => workflowSchema.parse(definition);

const seed = (registry: Registry, definitions: WorkflowDefinition[]): void => {
  registry.replace(new Map(definitions.map((definition) => [definition.name, definition])));
};

describe("workflowTools", () => {
  let dir: string;
  let db: KiriDb;
  let registry: Registry;
  let bus: EventBus;
  let events: KiriEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-workflow-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    registry = createRegistry();
    bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const tools = (overrides?: Partial<WorkflowToolsDeps>): ToolSet =>
    workflowTools({ db, registry, config: createConfigStore(dir), bus, ...overrides });

  describe("list_workflows", () => {
    it("lists each workflow's catalog fields and declared inputs", async () => {
      seed(registry, [
        define({
          name: "news",
          description: "Daily news digest",
          group: "News",
          inputs: [
            {
              name: "since",
              description: "Lookback window",
              required: true,
              default: "24h",
              options: ["24h", "7d"],
            },
          ],
          steps: [{ sh: "printf ok" }],
        }),
        define({ name: "mini", steps: [{ sh: "printf ok" }] }),
      ]);

      const output = await run(tools().list_workflows, {});

      expect(output).toEqual([
        {
          name: "news",
          description: "Daily news digest",
          group: "News",
          inputs: [
            {
              name: "since",
              description: "Lookback window",
              required: true,
              default: "24h",
              options: ["24h", "7d"],
            },
          ],
        },
        { name: "mini", description: undefined, group: undefined, inputs: undefined },
      ]);
    });

    it("returns an empty list when no workflows are defined", async () => {
      expect(await run(tools().list_workflows, {})).toEqual([]);
    });
  });

  describe("run_workflow", () => {
    it("rejects an unknown workflow name", () => {
      expect(run(tools().run_workflow, { name: "nope" })).rejects.toThrow(
        'No workflow named "nope" — call list_workflows',
      );
    });

    it("rejects a missing required input", () => {
      seed(registry, [
        define({
          name: "greet",
          inputs: [{ name: "who", required: true }],
          steps: [{ sh: "printf ok" }],
        }),
      ]);
      expect(run(tools().run_workflow, { name: "greet" })).rejects.toThrow(
        'Invalid inputs for workflow "greet": input "who" is required',
      );
    });

    it("rejects an input value outside the declared options", () => {
      seed(registry, [
        define({
          name: "news",
          inputs: [{ name: "since", options: ["24h", "7d"] }],
          steps: [{ sh: "printf ok" }],
        }),
      ]);
      expect(run(tools().run_workflow, { name: "news", inputs: { since: "1y" } })).rejects.toThrow(
        "is not one of the declared options",
      );
    });

    it("runs a workflow to completion and reports the compact outcome", async () => {
      seed(registry, [
        define({
          name: "greet",
          inputs: [{ name: "who", default: "world" }],
          steps: [
            { sh: 'printf "hello $WHO"', name: "Greet", env: { WHO: { input: "who" } } },
            { sh: "cat" },
          ],
          articles: [{ slug: "notes", sh: 'printf "# Notes"' }],
          summarize: { sh: 'printf "all done"' },
        }),
      ]);

      const output = await run(tools().run_workflow, { name: "greet", inputs: { who: "kiri" } });

      expect(output).toEqual({
        run_id: expect.any(String),
        status: "ok",
        error: undefined,
        summary: "all done",
        steps: [
          { name: "Greet", status: "ok", error: undefined },
          { name: "cat", status: "ok", error: undefined },
          { name: "article: notes", status: "ok", error: undefined },
          { name: "summarize", status: "ok", error: undefined },
        ],
        articles: [{ slug: "notes", name: "Notes" }],
      });

      // The run is first-class: it publishes the usual lifecycle events.
      const { run_id } = output as { run_id: string };
      expect(events).toContainEqual({ type: "run.started", id: run_id });
      expect(events).toContainEqual({ type: "run.finished", id: run_id, status: "ok" });
    });

    it("reports a failed run's outcome instead of throwing", async () => {
      seed(registry, [
        define({
          name: "broken",
          steps: [{ sh: "exit 7" }, { sh: "printf never" }],
        }),
      ]);

      const output = (await run(tools().run_workflow, { name: "broken" })) as {
        status: string;
        error?: string;
        steps: { status: string; error?: string }[];
      };

      expect(output.status).toBe("failed");
      expect(output.error).toBeString();
      // Fail-fast: the second step never ran, so only the failed row reports.
      expect(output.steps).toHaveLength(1);
      expect(output.steps[0]?.status).toBe("failed");
      expect(output.steps[0]?.error).toBe(output.error as string);
    });

    it("cancels the run it started when the turn aborts", async () => {
      seed(registry, [define({ name: "slow", steps: [{ sh: "sleep 5" }] })]);
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 25 });
      const controller = new AbortController();

      const pending = run(
        tools({ cancelRegistry }).run_workflow,
        { name: "slow" },
        { abortSignal: controller.signal },
      );
      setTimeout(() => controller.abort(), 50);

      const output = (await pending) as { status: string; steps: { status: string }[] };
      expect(output.status).toBe("cancelled");
      expect(output.steps[0]?.status).toBe("cancelled");
    });
  });
});
